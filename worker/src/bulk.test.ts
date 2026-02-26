import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { buildDirectoryTarGz } from "./bulk";

function makeUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://polyticker.example.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

describe("buildDirectoryTarGz", () => {
  beforeEach(async () => {
    const prefix = "btc-updown-5m";
    await env.BUCKET.put(`${prefix}/1740441600/event.json`, '{"test":1}');
    await env.BUCKET.put(`${prefix}/1740441600/meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740441600/raw/chainlink.jsonl`, '{"price":"96000"}\n');
    await env.BUCKET.put(`${prefix}/1740441900/event.json`, '{"test":2}');
    await env.BUCKET.put(`${prefix}/1740441900/meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740442200/event.json`, '{"test":3}');
    await env.BUCKET.put(`${prefix}/1740442200/meta.json`, '{"complete":true}');
  });

  it("returns all intervals when no from/to provided", async () => {
    const url = makeUrl("/btc-updown-5m/");
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="btc-updown-5m.tar.gz"'
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("returns 400 when only from is provided", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441600" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("returns 400 when only to is provided", async () => {
    const url = makeUrl("/btc-updown-5m/", { to: "1740441900" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("returns 400 when from is not numeric", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "abc", to: "1740441900" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
  });

  it("returns 400 when from > to", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441900", to: "1740441600" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(400);
  });

  it("returns 404 when no intervals match", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1000000000", to: "1000000300" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(404);
  });

  it("returns tar.gz with correct headers for valid range", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441600", to: "1740441900" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="btc-updown-5m_1740441600_1740441900.tar.gz"'
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("only includes intervals within the from/to range", async () => {
    const url = makeUrl("/btc-updown-5m/", { from: "1740441600", to: "1740441900" });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });

  it("returns 413 when range exceeds 288 intervals", async () => {
    for (let i = 0; i < 289; i++) {
      const epoch = 1700000000 + i * 300;
      await env.BUCKET.put(`btc-updown-5m/${epoch}/event.json`, "{}");
    }
    const from = "1700000000";
    const to = String(1700000000 + 288 * 300);
    const url = makeUrl("/btc-updown-5m/", { from, to });
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("range_too_large");
  });

  it("returns 413 when all intervals (no filter) exceed 288", async () => {
    for (let i = 0; i < 289; i++) {
      const epoch = 1700000000 + i * 300;
      await env.BUCKET.put(`btc-updown-5m/${epoch}/event.json`, "{}");
    }
    const url = makeUrl("/btc-updown-5m/");
    const res = await buildDirectoryTarGz(url, env.BUCKET, "btc-updown-5m/");
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("range_too_large");
  });

  it("returns 404 for a prefix with no interval subdirectories", async () => {
    const url = makeUrl("/nonexistent/");
    const res = await buildDirectoryTarGz(url, env.BUCKET, "nonexistent/");
    expect(res.status).toBe(404);
  });
});
