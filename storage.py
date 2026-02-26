import io
import os
import shutil
import tarfile
import tempfile
from pathlib import Path

import boto3
from loguru import logger


class R2:
    def __init__(self):
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        )
        self.bucket = os.environ.get("R2_BUCKET", "polyticker")

    def upload_interval(self, market_dir: Path, data_dir: Path):
        """Upload all files in an interval directory to R2, then delete local copy."""
        for file_path in sorted(market_dir.rglob("*")):
            if not file_path.is_file():
                continue
            key = str(file_path.relative_to(data_dir))
            self.client.upload_file(str(file_path), self.bucket, key)
            logger.info(f"[r2] uploaded {key}")

        self._upload_archive(market_dir, data_dir)

        shutil.rmtree(market_dir)
        logger.info(f"[r2] cleaned up {market_dir.name}")

    def _upload_archive(self, market_dir: Path, data_dir: Path):
        """Build a .tar.gz archive of the interval and upload it to R2.

        The archive flattens the raw/ subdirectory so all files appear at the
        top level (e.g. chainlink.jsonl instead of raw/chainlink.jsonl).
        """
        rel = market_dir.relative_to(data_dir)
        parts = rel.parts  # e.g. ("btc-updown-5m", "1772000000")
        market_name = parts[0]
        epoch = parts[1]
        archive_key = f"{market_name}/archives/{epoch}.tar.gz"

        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for file_path in sorted(market_dir.rglob("*")):
                if not file_path.is_file():
                    continue
                # Flatten: use just the filename, stripping any subdirectory
                arcname = file_path.name
                tar.add(str(file_path), arcname=arcname)
        buf.seek(0)

        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            tmp.write(buf.getvalue())
            tmp_path = tmp.name

        try:
            self.client.upload_file(tmp_path, self.bucket, archive_key)
            logger.info(f"[r2] uploaded archive {archive_key}")
        finally:
            os.unlink(tmp_path)
