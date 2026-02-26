"""
One-time backfill: create .tar.gz archives for existing intervals in R2.

Usage:
    uv run python backfill.py              # dry run (list what would be created)
    uv run python backfill.py --execute    # actually create archives

Requires R2 env vars (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).
"""

import io
import os
import re
import sys
import tarfile

import boto3
from loguru import logger

MARKET = "btc-updown-5m"
BUCKET = os.environ.get("R2_BUCKET", "polyticker")


def main():
    execute = "--execute" in sys.argv

    client = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    # List all existing interval epochs
    epochs = set()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=f"{MARKET}/", Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            name = prefix["Prefix"].rstrip("/").split("/")[-1]
            if re.match(r"^\d+$", name):
                epochs.add(int(name))

    # List existing archives
    existing_archives = set()
    for page in paginator.paginate(Bucket=BUCKET, Prefix=f"{MARKET}/archives/"):
        for obj in page.get("Contents", []):
            match = re.match(rf"^{MARKET}/archives/(\d+)\.tar\.gz$", obj["Key"])
            if match:
                existing_archives.add(int(match.group(1)))

    missing = sorted(epochs - existing_archives)
    logger.info(f"Total intervals: {len(epochs)}")
    logger.info(f"Existing archives: {len(existing_archives)}")
    logger.info(f"Missing archives: {len(missing)}")

    if not execute:
        logger.info("Dry run — pass --execute to create archives")
        for epoch in missing[:10]:
            logger.info(f"  would create: {MARKET}/archives/{epoch}.tar.gz")
        if len(missing) > 10:
            logger.info(f"  ... and {len(missing) - 10} more")
        return

    for i, epoch in enumerate(missing):
        logger.info(f"[{i + 1}/{len(missing)}] Building archive for {epoch}")

        # List all files in this interval
        prefix = f"{MARKET}/{epoch}/"
        files = []
        for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                files.append(obj["Key"])

        if not files:
            logger.warning(f"  No files found for {epoch}, skipping")
            continue

        # Build tar.gz in memory
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for key in sorted(files):
                resp = client.get_object(Bucket=BUCKET, Key=key)
                body = resp["Body"].read()
                # Flatten to just the filename, matching storage.py behaviour:
                # {market}/{epoch}/raw/chainlink.jsonl -> chainlink.jsonl
                # {market}/{epoch}/meta.json           -> meta.json
                relative = key[len(prefix) :]
                if "/" in relative:
                    relative = relative.rsplit("/", 1)[-1]
                info = tarfile.TarInfo(name=relative)
                info.size = len(body)
                tar.addfile(info, io.BytesIO(body))

        buf.seek(0)
        archive_key = f"{MARKET}/archives/{epoch}.tar.gz"
        client.put_object(Bucket=BUCKET, Key=archive_key, Body=buf.getvalue())
        logger.info(f"  uploaded {archive_key} ({buf.tell()} bytes)")


if __name__ == "__main__":
    main()
