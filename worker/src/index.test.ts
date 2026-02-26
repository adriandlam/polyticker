import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "./index";

function request(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://polyticker.example.com${path}`, { headers });
}

describe("smoke test", () => {
  it("responds to GET /", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/"),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});

describe("CORS", () => {
  it("includes Access-Control-Allow-Origin on all responses", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("HEAD requests", () => {
  it("responds to HEAD requests", async () => {
    const req = new Request("https://polyticker.example.com/", { method: "HEAD" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});

describe("JSON errors", () => {
  it("returns JSON 405 for non-GET/HEAD methods", async () => {
    const req = new Request("https://polyticker.example.com/", { method: "POST" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { error: string; message: string; status: number };
    expect(body.error).toBe("method_not_allowed");
    expect(body.message).toBe("Only GET and HEAD requests are supported");
    expect(body.status).toBe(405);
  });

  it("returns JSON 404 for missing objects", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/nonexistent.json"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { error: string; status: number };
    expect(body.error).toBe("not_found");
  });
});

describe("directory listing", () => {
  it("returns JSON by default", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { path: string; directories: unknown[]; files: unknown[] };
    expect(body.path).toBe("/");
    expect(body).toHaveProperty("directories");
    expect(body).toHaveProperty("files");
  });

  it("returns HTML when Accept: text/html", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/", { Accept: "text/html" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("caches directory listings for 5 minutes", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("includes directory entries with name and path", async () => {
    await env.BUCKET.put("btc-updown-5m/1771982700/event.json", "{}");

    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/btc-updown-5m/"), env, ctx);
    await waitOnExecutionContext(ctx);
    const body = await res.json() as {
      path: string;
      directories: { name: string; path: string }[];
      files: { name: string; path: string; size: number }[];
    };
    expect(body.path).toBe("/btc-updown-5m/");
    expect(body.directories).toContainEqual({
      name: "1771982700",
      path: "/btc-updown-5m/1771982700/",
    });
  });

  it("includes file entries with name, path, and size", async () => {
    await env.BUCKET.put("btc-updown-5m/1771982700/event.json", '{"test":true}');

    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/btc-updown-5m/1771982700/"), env, ctx);
    await waitOnExecutionContext(ctx);
    const body = await res.json() as {
      files: { name: string; path: string; size: number }[];
    };
    const file = body.files.find((f) => f.name === "event.json");
    expect(file).toBeDefined();
    expect(file!.path).toBe("/btc-updown-5m/1771982700/event.json");
    expect(file!.size).toBeGreaterThan(0);
  });
});

describe("trailing slash redirect", () => {
  it("redirects to trailing slash when path is a directory", async () => {
    await env.BUCKET.put("btc-updown-5m/1771998000/event.json", "{}");

    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/btc-updown-5m/1771998000"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(
      "https://polyticker.example.com/btc-updown-5m/1771998000/"
    );
  });
});

describe("file serving", () => {
  it("serves files with correct content type and CORS", async () => {
    await env.BUCKET.put("test/data.json", '{"hello":"world"}');

    const ctx = createExecutionContext();
    const res = await worker.fetch(request("/test/data.json"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ hello: "world" });
  });
});

describe("tar.gz content negotiation", () => {
  beforeEach(async () => {
    const prefix = "btc-updown-5m";
    await env.BUCKET.put(`${prefix}/1740441600.tar.gz`, "archive-1");
    await env.BUCKET.put(`${prefix}/1740441600.meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740441900.tar.gz`, "archive-2");
    await env.BUCKET.put(`${prefix}/1740441900.meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740442200.tar.gz`, "archive-3");
    await env.BUCKET.put(`${prefix}/1740442200.meta.json`, '{"complete":true}');
  });

  it("returns JSON archive list when Accept: application/gzip with no from/to", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/", { Accept: "application/gzip" }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json() as { archives: { epoch: number; url: string; size: number }[] };
    expect(body.archives).toHaveLength(3);
    expect(body.archives[0]).toEqual({
      epoch: 1740441600,
      url: "/btc-updown-5m/1740441600.tar.gz",
      size: expect.any(Number),
    });
    expect(body.archives[0].size).toBeGreaterThan(0);
  });

  it("returns JSON archive list for from/to range", async () => {
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
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="1740441600.tar.gz"'
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.text()).toBe("archive-1");
  });

  it("returns 413 when more than 288 archives", async () => {
    for (let i = 0; i < 289; i++) {
      const epoch = 1700000000 + i * 300;
      await env.BUCKET.put(`btc-updown-5m/${epoch}.tar.gz`, "x");
    }

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      request("/btc-updown-5m/?from=1700000000&to=" + String(1700000000 + 288 * 300), {
        Accept: "application/gzip",
      }),
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
