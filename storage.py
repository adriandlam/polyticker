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
            region_name="auto",
        )
        self.bucket = os.environ.get("R2_BUCKET", "polyticker")

    def upload_interval(self, market_dir: Path, data_dir: Path):
        """Build tar.gz + meta.json sidecar, upload to R2, delete local."""
        rel = market_dir.relative_to(data_dir)
        parts = rel.parts  # e.g. ("btc-updown-5m", "1772000000")
        market_name = parts[0]
        epoch = parts[1]

        # 1. Build tar.gz archive (flattened filenames, excludes meta.json)
        archive_key = f"{market_name}/{epoch}.tar.gz"
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for file_path in sorted(market_dir.rglob("*")):
                if not file_path.is_file():
                    continue
                if file_path.name == "meta.json":
                    continue
                arcname = file_path.name
                tar.add(str(file_path), arcname=arcname)
        buf.seek(0)

        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            tmp.write(buf.getvalue())
            tmp_path = tmp.name

        try:
            self.client.upload_file(tmp_path, self.bucket, archive_key)
            logger.info(f"[r2] uploaded {archive_key}")
        finally:
            os.unlink(tmp_path)

        # 2. Upload meta.json sidecar
        meta_path = market_dir / "meta.json"
        if meta_path.exists():
            meta_key = f"{market_name}/{epoch}.meta.json"
            self.client.upload_file(str(meta_path), self.bucket, meta_key)
            logger.info(f"[r2] uploaded {meta_key}")

        # 3. Delete local directory
        shutil.rmtree(market_dir)
        logger.info(f"[r2] cleaned up {market_dir.name}")
