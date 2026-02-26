# Pre-Built Per-Interval Archives

**Date:** 2026-02-25
**Status:** Approved

## Problem

The Worker currently builds tar.gz archives on-the-fly using CompressionStream and a streaming tar builder. This is CPU-intensive on the Worker and complex to maintain. Since the client already loops through intervals, we can build archives at collection time instead.

## Design

### Python Collector (storage.py)

After `upload_interval()` uploads the raw files (unchanged), it:
1. Builds a `.tar.gz` of the interval directory locally using Python's `tarfile`
2. Uploads it to R2 at `{market}/archives/{epoch}.tar.gz`
3. Deletes the local directory (as it already does)

The archive contains: `event.json`, `meta.json`, `raw/chainlink.jsonl`, `raw/binance.jsonl`, `raw/market.jsonl`.

### Worker (simplified bulk.ts)

Remove `CompressionStream`, streaming tar builder, and `tar.ts`. The download endpoint becomes:

- **Single interval** (`?from=X&to=X`): Serve the pre-built archive directly from R2. Zero CPU.
- **Range** (`?from=X&to=Y`): Return a JSON array of archive URLs:
  ```json
  {
    "archives": [
      {"epoch": 1740441600, "url": "/btc-updown-5m/archives/1740441600.tar.gz"},
      {"epoch": 1740441900, "url": "/btc-updown-5m/archives/1740441900.tar.gz"}
    ]
  }
  ```

### Client (download.py / backtest.py)

Loop through the JSON array, download each `.tar.gz` individually. Integrity check stays.

### Backfill Script (backfill.py)

One-time script:
1. Lists all existing interval epochs in R2 under `btc-updown-5m/`
2. For each epoch missing an archive: downloads the raw files, builds `.tar.gz`, uploads to `{market}/archives/{epoch}.tar.gz`
3. Run while bot is stopped

### Migration

1. Stop the bot
2. Deploy new collector code (with archive building)
3. Run backfill script for all existing intervals
4. Deploy new Worker code
5. Update client download scripts
6. Restart the bot

### Unchanged

- Raw files still uploaded to R2 (directory listing / HTML UI still works)
- `meta.json` completion tracking unchanged
- Existing file-serving routes in the Worker unchanged
- RTDS/WebSocket collection logic unchanged
