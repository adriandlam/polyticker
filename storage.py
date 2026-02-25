import os
import shutil
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

        shutil.rmtree(market_dir)
        logger.info(f"[r2] cleaned up {market_dir.name}")
