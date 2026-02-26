# Pre-Built Per-Interval Archives Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build .tar.gz archives at collection time in Python, simplify the Worker to serve them directly, and backfill existing data.

**Architecture:** After uploading raw files to R2, the Python collector builds a .tar.gz of each interval and uploads it to `{market}/archives/{epoch}.tar.gz`. The Worker's bulk endpoint is replaced with a simple archive-serving route. A one-time backfill script creates archives for existing intervals.

**Tech Stack:** Python tarfile, boto3, Cloudflare Worker (TypeScript), vitest

---

### Task 1: Add archive building to storage.py

**Files:**
- Modify: `storage.py:19-29`
- Test: `tests/test_storage.py`

**Step 1: Write the failing test**

Add to `tests/test_storage.py`:

```python
def test_upload_interval_creates_archive(tmp_path, monkeypatch):
    monkeypatch.setenv("R2_ENDPOINT", "https://fake.r2.dev")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET", "test-bucket")

    mock_client = MagicMock()
    monkeypatch.setattr("storage.boto3.client", lambda *a, **kw: mock_client)

    r2 = R2()
    data_dir, market_dir = _make_interval(tmp_path)

    r2.upload_interval(market_dir, data_dir)

    uploaded_keys = sorted(
        call.args[2] for call in mock_client.upload_file.call_args_list
    )
    assert "btc-updown-5m/archives/1772000000.tar.gz" in uploaded_keys


def test_archive_contains_all_files(tmp_path, monkeypatch):
    import io
    import tarfile as tf

    monkeypatch.setenv("R2_ENDPOINT", "https://fake.r2.dev")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET", "test-bucket")

    # Capture the archive file path before it gets deleted
    uploaded_files = {}

    def fake_upload(local_path, bucket, key):
        if key.endswith(".tar.gz"):
            with open(local_path, "rb") as f:
                uploaded_files[key] = f.read()

    mock_client = MagicMock()
    mock_client.upload_file.side_effect = fake_upload
    monkeypatch.setattr("storage.boto3.client", lambda *a, **kw: mock_client)

    r2 = R2()
    data_dir, market_dir = _make_interval(tmp_path)

    r2.upload_interval(market_dir, data_dir)

    archive_key = "btc-updown-5m/archives/1772000000.tar.gz"
    assert archive_key in uploaded_files

    archive = tf.open(fileobj=io.BytesIO(uploaded_files[archive_key]), mode="r:gz")
    names = sorted(archive.getnames())
    assert names == [
        "binance.jsonl",
        "chainlink.jsonl",
        "event.json",
        "market.jsonl",
        "meta.json",
    ]
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_storage.py -v`
Expected: FAIL — no archive key in uploaded files

**Step 3: Implement archive building in storage.py**

Replace `upload_interval` in `storage.py`:

```python
import io
import tarfile

# ... existing imports ...

class R2:
    # ... existing __init__ ...

    def upload_interval(self, market_dir: Path, data_dir: Path):
        """Upload all files in an interval directory to R2, then delete local copy."""
        for file_path in sorted(market_dir.rglob("*")):
            if not file_path.is_file():
                continue
            key = str(file_path.relative_to(data_dir))
            self.client.upload_file(str(file_path), self.bucket, key)
            logger.info(f"[r2] uploaded {key}")

        # Build and upload .tar.gz archive
        self._upload_archive(market_dir, data_dir)

        shutil.rmtree(market_dir)
        logger.info(f"[r2] cleaned up {market_dir.name}")

    def _upload_archive(self, market_dir: Path, data_dir: Path):
        """Build a .tar.gz of the interval and upload to R2."""
        # Path: {market}/archives/{epoch}.tar.gz
        relative = market_dir.relative_to(data_dir)
        market_name = relative.parts[0]  # e.g. "btc-updown-5m"
        epoch = relative.parts[1]        # e.g. "1772000000"
        archive_key = f"{market_name}/archives/{epoch}.tar.gz"

        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for file_path in sorted(market_dir.rglob("*")):
                if not file_path.is_file():
                    continue
                # Flatten: strip market_dir prefix, and also strip "raw/" subdir
                arcname = file_path.relative_to(market_dir)
                # raw/chainlink.jsonl -> chainlink.jsonl
                # event.json -> event.json
                if arcname.parts[0] == "raw":
                    arcname = Path(*arcname.parts[1:])
                tar.add(file_path, arcname=str(arcname))

        buf.seek(0)
        archive_path = market_dir.parent / f"{epoch}.tar.gz"
        archive_path.write_bytes(buf.getvalue())
        self.client.upload_file(str(archive_path), self.bucket, archive_key)
        archive_path.unlink()
        logger.info(f"[r2] uploaded archive {archive_key}")
```

Note: The archive flattens the `raw/` subdirectory so archive contents are just the file names directly (event.json, meta.json, chainlink.jsonl, binance.jsonl, market.jsonl). This simplifies client extraction.

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_storage.py -v`
Expected: All PASS

**Step 5: Update existing test assertion**

The existing `test_upload_interval` test checks `uploaded_keys` — it needs to include the archive key now. Update the assertion in the existing test:

```python
assert uploaded_keys == [
    "btc-updown-5m/1772000000/event.json",
    "btc-updown-5m/1772000000/meta.json",
    "btc-updown-5m/1772000000/raw/binance.jsonl",
    "btc-updown-5m/1772000000/raw/chainlink.jsonl",
    "btc-updown-5m/1772000000/raw/market.jsonl",
    "btc-updown-5m/archives/1772000000.tar.gz",
]
```

**Step 6: Run all tests**

Run: `uv run pytest tests/test_storage.py -v`
Expected: All PASS

**Step 7: Commit**

```bash
git add storage.py tests/test_storage.py
git commit -m "feat: build .tar.gz archive at collection time"
```

---

### Task 2: Replace Worker bulk endpoint with archive-serving

**Files:**
- Rewrite: `worker/src/bulk.ts`
- Delete: `worker/src/tar.ts`
- Modify: `worker/src/index.ts:1,17-19`
- Rewrite: `worker/src/bulk.test.ts`
- Delete: `worker/src/tar.test.ts`

**Step 1: Write failing tests for new bulk.ts**

Replace `worker/src/bulk.test.ts` entirely:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { handleArchiveRequest } from "./bulk";

function makeUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://polyticker.example.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

describe("handleArchiveRequest", () => {
  beforeEach(async () => {
    // Pre-built archives in R2
    await env.BUCKET.put("btc-updown-5m/archives/1740441600.tar.gz", "fake-archive-1");
    await env.BUCKET.put("btc-updown-5m/archives/1740441900.tar.gz", "fake-archive-2");
    await env.BUCKET.put("btc-updown-5m/archives/1740442200.tar.gz", "fake-archive-3");
  });

  it("returns 400 when only from is provided", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441600" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
  });

  it("returns 400 when only to is provided", async () => {
    const url = makeUrl("/btc-updown-5m/", { to: "1740441900" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
  });

  it("returns 400 when from is not numeric", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "abc", to: "1740441900" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
  });

  it("returns 400 when from > to", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441900", to: "1740441600" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
  });

  it("serves single archive directly when from === to", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441600", to: "1740441600" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="1740441600.tar.gz"'
    );
    expect(await res.text()).toBe("fake-archive-1");
  });

  it("returns 404 when single archive not found", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "9999999999", to: "9999999999" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(404);
  });

  it("returns JSON array of URLs for a range", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441600", to: "1740442200" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { archives: { epoch: number; url: string }[] };
    expect(body.archives).toHaveLength(3);
    expect(body.archives[0]).toEqual({
      epoch: 1740441600,
      url: "/btc-updown-5m/archives/1740441600.tar.gz",
    });
    expect(body.archives[2]).toEqual({
      epoch: 1740442200,
      url: "/btc-updown-5m/archives/1740442200.tar.gz",
    });
  });

  it("returns 404 when no archives found in range", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1000000000", to: "1000000300" });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(404);
  });

  it("returns 413 when range exceeds 288 intervals", async () => {
    for (let i = 0; i < 289; i++) {
      const epoch = 1700000000 + i * 300;
      await env.BUCKET.put(`btc-updown-5m/archives/${epoch}.tar.gz`, "x");
    }
    const url = makeUrl("/btc-updown-5m/", { from: "1700000000", to: String(1700000000 + 288 * 300) });
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(413);
  });

  it("returns all archives when no from/to provided", async () => {
    const url = makeUrl("/btc-updown-5m/");
    const res = await handleArchiveRequest(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(200);
    const body = await res.json() as { archives: { epoch: number; url: string }[] };
    expect(body.archives).toHaveLength(3);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd worker && pnpm test`
Expected: FAIL — `handleArchiveRequest` not found

**Step 3: Implement new bulk.ts**

Replace `worker/src/bulk.ts` entirely:

```typescript
const MAX_INTERVALS = 288;

/**
 * Handle archive requests: serve pre-built .tar.gz files from R2.
 *
 * - Single interval (from === to): serve archive directly from R2
 * - Range (from < to) or no params: return JSON array of archive URLs
 */
export async function handleArchiveRequest(
  url: URL,
  bucket: R2Bucket,
  prefix: string
): Promise<Response> {
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  if ((fromStr == null) !== (toStr == null)) {
    return jsonError("bad_request", "Both 'from' and 'to' query parameters are required when filtering by range", 400);
  }

  let from: number | null = null;
  let to: number | null = null;

  if (fromStr != null && toStr != null) {
    from = Number(fromStr);
    to = Number(toStr);

    if (isNaN(from) || isNaN(to) || !Number.isInteger(from) || !Number.isInteger(to)) {
      return jsonError("bad_request", "'from' and 'to' must be integer epoch timestamps", 400);
    }

    if (from > to) {
      return jsonError("bad_request", "'from' must be less than or equal to 'to'", 400);
    }
  }

  // Extract market name from prefix (e.g. "btc-updown-5m/" -> "btc-updown-5m")
  const market = prefix.replace(/\/$/, "");
  const archivePrefix = `${market}/archives/`;

  // Single interval: serve archive directly
  if (from !== null && from === to) {
    const key = `${archivePrefix}${from}.tar.gz`;
    const object = await bucket.get(key);
    if (!object) {
      return jsonError("not_found", `Archive not found: ${from}`, 404);
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${from}.tar.gz"`,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // List all archives (paginated)
  const archives: { epoch: number; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: archivePrefix, cursor });
    for (const obj of listed.objects) {
      const filename = obj.key.slice(archivePrefix.length);
      const match = filename.match(/^(\d+)\.tar\.gz$/);
      if (!match) continue;
      const epoch = parseInt(match[1], 10);
      if (from !== null && to !== null && (epoch < from || epoch > to)) continue;
      archives.push({ epoch, url: `/${obj.key}` });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  if (archives.length === 0) {
    return jsonError("not_found", "No archives found in the specified range", 404);
  }

  if (archives.length > MAX_INTERVALS) {
    return jsonError(
      "range_too_large",
      `Range contains ${archives.length} archives, max is ${MAX_INTERVALS}. Narrow your from/to range.`,
      413
    );
  }

  archives.sort((a, b) => a.epoch - b.epoch);

  return new Response(JSON.stringify({ archives }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function jsonError(error: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error, message, status }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
```

**Step 4: Update index.ts**

Change the import and the gzip handler in `worker/src/index.ts`:

- Line 1: Change `import { buildDirectoryTarGz } from "./bulk"` to `import { handleArchiveRequest } from "./bulk"`
- Line 19: Change `return cors(await buildDirectoryTarGz(url, env.BUCKET, path))` to `return cors(await handleArchiveRequest(url, env.BUCKET, path))`

**Step 5: Delete tar.ts and tar.test.ts**

```bash
rm worker/src/tar.ts worker/src/tar.test.ts
```

**Step 6: Update index.test.ts**

The `tar.gz content negotiation` describe block in `worker/src/index.test.ts` needs updating. The tests that check for streaming tar.gz responses (gzip magic bytes) need to change:
- Tests with `Accept: application/gzip` and no from/to now return JSON (archive list), not gzip
- Tests with `Accept: application/gzip` and from/to where from !== to now return JSON
- Tests with `Accept: application/gzip` and from === to now return the archive body directly
- The test data setup needs to include archives in `{market}/archives/{epoch}.tar.gz`

Replace the `tar.gz content negotiation` describe block:

```typescript
describe("tar.gz content negotiation", () => {
  beforeEach(async () => {
    // Raw files (for directory listing)
    const prefix = "btc-updown-5m";
    await env.BUCKET.put(`${prefix}/1740441600/event.json`, '{"test":1}');
    await env.BUCKET.put(`${prefix}/1740441900/event.json`, '{"test":2}');
    await env.BUCKET.put(`${prefix}/1740442200/event.json`, '{"test":3}');
    // Pre-built archives
    await env.BUCKET.put(`${prefix}/archives/1740441600.tar.gz`, "archive-1");
    await env.BUCKET.put(`${prefix}/archives/1740441900.tar.gz`, "archive-2");
    await env.BUCKET.put(`${prefix}/archives/1740442200.tar.gz`, "archive-3");
  });

  it("returns archive list JSON when Accept: application/gzip and no from/to", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/", { Accept: "application/gzip" }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { archives: { epoch: number; url: string }[] };
    expect(body.archives).toHaveLength(3);
  });

  it("returns archive list JSON for a range", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/?from=1740441600&to=1740441900", {
        Accept: "application/gzip",
      }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { archives: { epoch: number; url: string }[] };
    expect(body.archives).toHaveLength(2);
  });

  it("serves single archive directly when from === to", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/?from=1740441600&to=1740441600", {
        Accept: "application/gzip",
      }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(await res.text()).toBe("archive-1");
  });

  it("returns 413 when more than 288 archives", async () => {
    for (let i = 0; i < 289; i++) {
      const epoch = 1700000000 + i * 300;
      await env.BUCKET.put(`btc-updown-5m/archives/${epoch}.tar.gz`, "x");
    }

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/", { Accept: "application/gzip" }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("range_too_large");
  });

  it("returns 400 for non-integer from/to params", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/?from=abc&to=123", {
        Accept: "application/gzip",
      }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("returns 404 for nonexistent directory", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/nonexistent/", { Accept: "application/gzip" }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("returns JSON when Accept header is not application/gzip", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/btc-updown-5m/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe("/btc-updown-5m/");
  });

  it("returns 400 when only from is provided", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/?from=1740441600", {
        Accept: "application/gzip",
      }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when from > to", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/?from=1740441900&to=1740441600", {
        Accept: "application/gzip",
      }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});
```

**Step 7: Run all worker tests**

Run: `cd worker && pnpm test`
Expected: All PASS

**Step 8: Commit**

```bash
git add worker/src/bulk.ts worker/src/index.ts worker/src/bulk.test.ts worker/src/index.test.ts
git rm worker/src/tar.ts worker/src/tar.test.ts
git commit -m "feat(worker): replace streaming tar with pre-built archive serving"
```

---

### Task 3: Write backfill script

**Files:**
- Create: `backfill.py`

**Step 1: Write the backfill script**

```python
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
                # Flatten: {market}/{epoch}/raw/file.jsonl -> file.jsonl
                #          {market}/{epoch}/file.json -> file.json
                relative = key[len(prefix):]
                if relative.startswith("raw/"):
                    relative = relative[4:]
                info = tarfile.TarInfo(name=relative)
                info.size = len(body)
                tar.addfile(info, io.BytesIO(body))

        buf.seek(0)
        archive_key = f"{MARKET}/archives/{epoch}.tar.gz"
        client.put_object(Bucket=BUCKET, Key=archive_key, Body=buf.getvalue())
        logger.info(f"  uploaded {archive_key} ({buf.tell()} bytes)")


if __name__ == "__main__":
    main()
```

**Step 2: Test manually with dry run**

Run: `uv run python backfill.py`
Expected: Lists intervals that need archives, shows dry run message

**Step 3: Run the backfill**

Run: `uv run python backfill.py --execute`
Expected: Creates all missing archives in R2

**Step 4: Commit**

```bash
git add backfill.py
git commit -m "feat: add one-time backfill script for interval archives"
```

---

### Task 4: Update backtest example

**Files:**
- Modify: `docs/examples/backtest.py`

**Step 1: Update backtest.py to use per-interval archives**

The example currently expects a daily archive. Update it to use the new archive list endpoint:

```python
"""
Example backtest: download per-interval archives, replay all intervals, and compute
basic P&L for a naive "always bet Up" strategy.

Usage:
    python backtest.py https://polyticker.example.com 2026-02-25

Requires: requests (pip install requests)
"""

import io
import json
import sys
import tarfile
from datetime import datetime, timezone

import requests

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "https://polyticker.example.com"
DATE = sys.argv[2] if len(sys.argv) > 2 else "2026-02-25"


def main():
    # Convert date to epoch range
    dt = datetime.strptime(DATE, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_start = int(dt.timestamp())
    day_end = day_start + 86400 - 300  # last interval of the day

    # Get archive list for the day
    list_url = f"{BASE_URL}/btc-updown-5m/?from={day_start}&to={day_end}"
    print(f"Fetching archive list: {list_url}")
    resp = requests.get(list_url, headers={"Accept": "application/gzip"})
    resp.raise_for_status()
    archive_list = resp.json()["archives"]
    print(f"Found {len(archive_list)} intervals")

    results = []

    for entry in archive_list:
        epoch = entry["epoch"]
        archive_url = f"{BASE_URL}{entry['url']}"
        resp = requests.get(archive_url)
        resp.raise_for_status()

        archive = tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz")
        files = {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}

        event = json.loads(files.get("event.json", "{}"))
        if not event:
            continue

        meta = json.loads(files.get("meta.json", "{}"))
        if not meta.get("complete", False):
            continue

        events = []
        for key in ("chainlink.jsonl", "binance.jsonl", "market.jsonl"):
            raw = files.get(key, b"")
            for line in raw.decode().strip().split("\n"):
                if line:
                    events.append(json.loads(line))

        events.sort(key=lambda e: int(e.get("timestamp", 0)))

        resolution = None
        for e in events:
            if e.get("event_type") == "market_resolved":
                resolution = e.get("winning_outcome")
                break

        market = event.get("markets", [{}])[0]
        prices = json.loads(market.get("outcomePrices", "[]"))
        if len(prices) < 1:
            continue

        buy_price = float(prices[0])
        pnl = (1.0 - buy_price) if resolution == "Up" else -buy_price

        results.append(
            {
                "epoch": epoch,
                "buy_price": buy_price,
                "resolution": resolution,
                "pnl": round(pnl, 4),
            }
        )

    total_pnl = sum(r["pnl"] for r in results)
    wins = sum(1 for r in results if r["pnl"] > 0)
    total = len(results)

    print(f"\n{'=' * 50}")
    print(f"Date: {DATE}")
    print(f"Intervals: {total}")
    if total:
        print(f"Wins: {wins}/{total} ({100 * wins / total:.1f}%)")
    else:
        print("No data")
    print(f"Total P&L: {total_pnl:+.4f}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
```

Note: The key changes are:
- No more daily archive URL — uses the archive list endpoint
- Converts date to epoch range
- Loops through individual archives
- File names no longer have `raw/` prefix (flattened in archive)

**Step 2: Commit**

```bash
git add docs/examples/backtest.py
git commit -m "docs: update backtest example for per-interval archives"
```

---

### Task 5: Deploy and restart

**Step 1: Deploy the Worker**

```bash
cd worker && pnpm deploy
```

**Step 2: Deploy collector to server**

Push the updated code, SSH in, pull, restart the service.

**Step 3: Verify**

- Check a known archive URL returns the .tar.gz
- Check the archive list endpoint returns JSON
- Verify the backtest example runs against production
