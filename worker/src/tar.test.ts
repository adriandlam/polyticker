import { describe, it, expect } from "vitest";
import { tarHeader } from "./tar";

describe("tarHeader", () => {
  it("produces a 512-byte POSIX tar header", () => {
    const header = tarHeader("hello.txt", 11);
    expect(header.length).toBe(512);
  });

  it("encodes filename at offset 0", () => {
    const header = tarHeader("hello.txt", 0);
    const name = new TextDecoder().decode(header.slice(0, 9));
    expect(name).toBe("hello.txt");
  });

  it("encodes file size in octal at offset 124", () => {
    const header = tarHeader("test.txt", 1024);
    const sizeStr = new TextDecoder().decode(header.slice(124, 135));
    expect(sizeStr).toBe("00000002000"); // 1024 in octal
  });

  it("sets USTAR magic at offset 257", () => {
    const header = tarHeader("a.txt", 0);
    const magic = new TextDecoder().decode(header.slice(257, 263));
    expect(magic).toBe("ustar\0");
  });

  it("sets type flag to regular file (0x30)", () => {
    const header = tarHeader("a.txt", 0);
    expect(header[156]).toBe(0x30);
  });

  it("computes a valid checksum", () => {
    const header = tarHeader("test.txt", 42);
    // Re-compute: treat checksum field (148-155) as spaces, sum all bytes
    let expected = 0;
    for (let i = 0; i < 512; i++) {
      if (i >= 148 && i < 156) {
        expected += 0x20;
      } else {
        expected += header[i];
      }
    }
    const checksumStr = new TextDecoder().decode(header.slice(148, 154));
    const actual = parseInt(checksumStr, 8);
    expect(actual).toBe(expected);
  });
});
