import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
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

describe("JSON errors", () => {
  it("returns JSON 405 for non-GET methods", async () => {
    const req = new Request("https://polyticker.example.com/", { method: "POST" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json() as { error: string; message: string; status: number };
    expect(body.error).toBe("method_not_allowed");
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
