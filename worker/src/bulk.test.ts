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
