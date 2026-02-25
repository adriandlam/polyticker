import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "./index";

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
