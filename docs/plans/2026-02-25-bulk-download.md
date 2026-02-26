# Bulk Download Endpoint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `GET /archives/{market}/bulk?from={epoch}&to={epoch}` endpoint that returns a single tar.gz of all matching intervals.

**Architecture:** New `bulk.ts` module exports a handler function called from `index.ts`. It lists R2 interval prefixes, filters by epoch range, fetches all files, builds a tar.gz using the existing `createTarGz()`, and returns it. A 288-interval cap prevents memory abuse.

**Tech Stack:** Cloudflare Workers, R2, existing `tar.ts` utilities, vitest with `@cloudflare/vitest-pool-workers`

---

### Task 1: Add bulk handler module with tests

**Files:**
- Create: `worker/src/bulk.ts`
- Create: `worker/src/bulk.test.ts`

**Step 1: Write the failing tests**

Create `worker/src/bulk.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { handleBulkDownload } from "./bulk";

function bulkRequest(market: string, params: Record<string, string>) {
  const url = new URL(`https://polyticker.example.com/archives/${market}/bulk`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url, bucket: env.BUCKET };
}

describe("handleBulkDownload", () => {
  beforeEach(async () => {
    // Epoch 1740441600 = 2025-02-25 00:00:00 UTC
    // Epoch 1740441900 = 2025-02-25 00:05:00 UTC
    // Epoch 1740442200 = 2025-02-25 00:10:00 UTC
    const prefix = "btc-updown-5m";
    await env.BUCKET.put(`${prefix}/1740441600/event.json`, '{"test":1}');
    await env.BUCKET.put(`${prefix}/1740441600/meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740441600/raw/chainlink.jsonl`, '{"price":"96000"}\n');
    await env.BUCKET.put(`${prefix}/1740441900/event.json`, '{"test":2}');
    await env.BUCKET.put(`${prefix}/1740441900/meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740442200/event.json`, '{"test":3}');
    await env.BUCKET.put(`${prefix}/1740442200/meta.json`, '{"complete":true}');
  });

  it("returns 400 when from is missing", async () => {
    const { url, bucket } = bulkRequest("btc-updown-5m", { to: "1740441900" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("returns 400 when to is missing", async () => {
    const { url, bucket } = bulkRequest("btc-updown-5m", { from: "1740441600" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("returns 400 when from is not numeric", async () => {
    const { url, bucket } = bulkRequest("btc-updown-5m", { from: "abc", to: "1740441900" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(400);
  });

  it("returns 400 when from > to", async () => {
    const { url, bucket } = bulkRequest("btc-updown-5m", { from: "1740441900", to: "1740441600" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(400);
  });

  it("returns 404 when no intervals match", async () => {
    const { url, bucket } = bulkRequest("btc-updown-5m", { from: "1000000000", to: "1000000300" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(404);
  });

  it("returns tar.gz with correct headers for valid range", async () => {
    const { url, bucket } = bulkRequest("btc-updown-5m", { from: "1740441600", to: "1740441900" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="btc-updown-5m_1740441600_1740441900.tar.gz"'
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");

    // Verify gzip magic bytes
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("only includes intervals within the from/to range", async () => {
    // Request only the first two intervals, excluding 1740442200
    const { url, bucket } = bulkRequest("btc-updown-5m", { from: "1740441600", to: "1740441900" });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(200);
    await res.arrayBuffer(); // consume body
  });

  it("returns 413 when range exceeds 288 intervals", async () => {
    // Seed 289 intervals
    for (let i = 0; i < 289; i++) {
      const epoch = 1700000000 + i * 300;
      await env.BUCKET.put(`btc-updown-5m/${epoch}/event.json`, "{}");
    }
    const from = "1700000000";
    const to = String(1700000000 + 288 * 300);
    const { url, bucket } = bulkRequest("btc-updown-5m", { from, to });
    const res = await handleBulkDownload(url, bucket, "btc-updown-5m");
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("range_too_large");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/bulk.test.ts`
Expected: FAIL — `handleBulkDownload` does not exist

**Step 3: Write the implementation**

Create `worker/src/bulk.ts`:

```typescript
import { createTarGz } from "./tar";

const MAX_INTERVALS = 288;

interface TarEntry {
  name: string;
  data: Uint8Array;
}

export async function handleBulkDownload(
  url: URL,
  bucket: R2Bucket,
  market: string
): Promise<Response> {
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  if (!fromStr || !toStr) {
    return jsonError("bad_request", "Both 'from' and 'to' query parameters are required", 400);
  }

  const from = Number(fromStr);
  const to = Number(toStr);

  if (isNaN(from) || isNaN(to) || !Number.isInteger(from) || !Number.isInteger(to)) {
    return jsonError("bad_request", "'from' and 'to' must be integer epoch timestamps", 400);
  }

  if (from > to) {
    return jsonError("bad_request", "'from' must be less than or equal to 'to'", 400);
  }

  // List all interval directories for this market
  const listed = await bucket.list({ prefix: `${market}/`, delimiter: "/" });
  const prefixes = (listed.delimitedPrefixes || []).filter((p) => {
    const epoch = parseInt(p.split("/")[1], 10);
    return !isNaN(epoch) && epoch >= from && epoch <= to;
  });

  if (prefixes.length === 0) {
    return jsonError("not_found", "No intervals found in the specified range", 404);
  }

  if (prefixes.length > MAX_INTERVALS) {
    return jsonError(
      "range_too_large",
      `Range contains ${prefixes.length} intervals, max is ${MAX_INTERVALS}. Narrow your from/to range.`,
      413
    );
  }

  // Collect all files for matching intervals
  const entries: TarEntry[] = [];

  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const result = await bucket.list({ prefix, cursor });
      for (const obj of result.objects) {
        const body = await bucket.get(obj.key);
        if (!body) continue;
        const data = new Uint8Array(await body.arrayBuffer());
        const relativePath = obj.key.slice(`${market}/`.length);
        entries.push({ name: relativePath, data });
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }

  if (entries.length === 0) {
    return jsonError("not_found", "No files found in matching intervals", 404);
  }

  const archive = await createTarGz(entries);

  return new Response(archive, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${market}_${from}_${to}.tar.gz"`,
      "Content-Length": archive.size.toString(),
      "Cache-Control": "public, max-age=86400",
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

**Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/bulk.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add worker/src/bulk.ts worker/src/bulk.test.ts
git commit -m "feat(worker): add bulk download handler with tests"
```

---

### Task 2: Wire bulk endpoint into the main router

**Files:**
- Modify: `worker/src/index.ts:17-73` (archive routes section)
- Modify: `worker/src/index.test.ts` (add integration tests)

**Step 1: Write failing integration tests**

Add to the end of `worker/src/index.test.ts`, before the last closing:

```typescript
describe("bulk download endpoint", () => {
  beforeEach(async () => {
    await env.BUCKET.put("btc-updown-5m/1740441600/event.json", '{"test":1}');
    await env.BUCKET.put("btc-updown-5m/1740441600/meta.json", '{"complete":true}');
    await env.BUCKET.put("btc-updown-5m/1740441900/event.json", '{"test":2}');
    await env.BUCKET.put("btc-updown-5m/1740441900/meta.json", '{"complete":true}');
  });

  it("returns tar.gz for valid epoch range", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/archives/btc-updown-5m/bulk?from=1740441600&to=1740441900"),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("returns 400 for missing params", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/archives/btc-updown-5m/bulk"),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 for empty range", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/archives/btc-updown-5m/bulk?from=1000000000&to=1000000300"),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/index.test.ts`
Expected: FAIL — `/archives/btc-updown-5m/bulk` returns 404 (no route for it yet)

**Step 3: Wire the route into index.ts**

In `worker/src/index.ts`, add the import at the top (line 1):

```typescript
import { generateDailyArchive } from "./archive";
import { handleBulkDownload } from "./bulk";
```

Then in the archive routes section, add the bulk route **before** the existing `path.endsWith("/")` check (after line 17, before line 19). The bulk path looks like `archives/btc-updown-5m/bulk` — it doesn't end in `/` or `.tar.gz`, so we match it explicitly:

```typescript
    // Archive routes
    if (path.startsWith("archives/")) {
      // Bulk download: /archives/<market>/bulk?from=...&to=...
      const bulkMatch = path.match(/^archives\/([^/]+)\/bulk$/);
      if (bulkMatch) {
        return handleBulkDownload(url, env.BUCKET, bulkMatch[1]);
      }

      // Archive market listing: /archives/btc-updown-5m/
      if (path.endsWith("/")) {
```

**Step 4: Run all tests**

Run: `cd worker && npx vitest run`
Expected: All tests PASS (bulk.test.ts + index.test.ts + archive.test.ts + tar.test.ts)

**Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/index.test.ts
git commit -m "feat(worker): wire bulk download endpoint into router"
```

---

### Task 3: Manual smoke test

**Step 1: Run the dev server**

Run: `cd worker && npx wrangler dev`

**Step 2: Test with curl**

```bash
# Should return 400
curl -s "http://localhost:8787/archives/btc-updown-5m/bulk" | jq .

# Should return a tar.gz (if data exists) or 404
curl -o bulk.tar.gz "http://localhost:8787/archives/btc-updown-5m/bulk?from=1740441600&to=1740528000"

# Inspect the tar contents
tar tzf bulk.tar.gz
```

**Step 3: Stop dev server, commit any fixes if needed**
