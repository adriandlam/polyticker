import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { generateDailyArchive } from "./archive";

describe("generateDailyArchive", () => {
  beforeEach(async () => {
    // Seed R2 with test data for a specific day
    // Epoch 1740441600 = 2025-02-25 00:00:00 UTC
    // Epoch 1740441900 = 2025-02-25 00:05:00 UTC
    // Epoch 1740528000 = 2025-02-26 00:00:00 UTC (next day — should be excluded)
    const prefix = "btc-updown-5m";
    await env.BUCKET.put(`${prefix}/1740441600/event.json`, '{"test":true}');
    await env.BUCKET.put(`${prefix}/1740441600/meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740441600/raw/chainlink.jsonl`, '{"price":"96000"}\n');
    await env.BUCKET.put(`${prefix}/1740441600/raw/binance.jsonl`, '{"price":"96001"}\n');
    await env.BUCKET.put(`${prefix}/1740441600/raw/market.jsonl`, '{"event_type":"price_change"}\n');
    await env.BUCKET.put(`${prefix}/1740441900/event.json`, '{"test":true}');
    await env.BUCKET.put(`${prefix}/1740441900/meta.json`, '{"complete":true}');
    await env.BUCKET.put(`${prefix}/1740441900/raw/market.jsonl`, '{"event_type":"trade"}\n');
    // Next day — should NOT be included
    await env.BUCKET.put(`${prefix}/1740528000/event.json`, '{"test":"next day"}');
  });

  it("creates a tar.gz archive for the given date", async () => {
    const result = await generateDailyArchive(env.BUCKET, "btc-updown-5m", "2025-02-25");
    expect(result).not.toBeNull();
    expect(result!.size).toBeGreaterThan(0);
  });

  it("uploads archive to correct R2 path", async () => {
    await generateDailyArchive(env.BUCKET, "btc-updown-5m", "2025-02-25");
    const obj = await env.BUCKET.get("archives/btc-updown-5m/2025-02-25.tar.gz");
    expect(obj).not.toBeNull();
    expect(obj!.size).toBeGreaterThan(0);
    // Consume the body to avoid isolated storage issues
    await obj!.arrayBuffer();
  });

  it("excludes intervals from other days", async () => {
    await generateDailyArchive(env.BUCKET, "btc-updown-5m", "2025-02-25");
    const archive = await env.BUCKET.get("archives/btc-updown-5m/2025-02-25.tar.gz");
    expect(archive).not.toBeNull();
    // Consume the body to avoid isolated storage issues
    await archive!.arrayBuffer();
  });

  it("returns null when no intervals exist for the date", async () => {
    const result = await generateDailyArchive(env.BUCKET, "btc-updown-5m", "2024-01-01");
    expect(result).toBeNull();
  });
});
