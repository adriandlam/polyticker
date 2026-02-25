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
