import { describe, it, expect } from "vitest";
import { createTarGz } from "./tar";

describe("createTarGz", () => {
  it("produces a valid gzip stream from file entries", async () => {
    const files = [
      { name: "hello.txt", data: new TextEncoder().encode("hello world") },
    ];

    const blob = await createTarGz(files);
    expect(blob.size).toBeGreaterThan(0);

    // Gzip magic number: 1f 8b
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("includes multiple files", async () => {
    const files = [
      { name: "a.txt", data: new TextEncoder().encode("aaa") },
      { name: "dir/b.txt", data: new TextEncoder().encode("bbb") },
    ];

    const blob = await createTarGz(files);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("handles empty file list", async () => {
    const blob = await createTarGz([]);
    expect(blob.size).toBeGreaterThan(0);
  });
});
