interface TarEntry {
  name: string;
  data: Uint8Array;
}

export async function createTarGz(entries: TarEntry[]): Promise<Blob> {
  const tarBytes = buildTar(entries);
  const blob = new Blob([tarBytes]);
  const compressed = blob.stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed).blob();
}

function buildTar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const entry of entries) {
    blocks.push(tarHeader(entry.name, entry.data.length));
    blocks.push(entry.data);
    const remainder = entry.data.length % 512;
    if (remainder > 0) {
      blocks.push(new Uint8Array(512 - remainder));
    }
  }

  // End-of-archive: two 512-byte zero blocks
  blocks.push(new Uint8Array(1024));

  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    result.set(block, offset);
    offset += block.length;
  }
  return result;
}

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);

  // File name (0-99, 100 bytes)
  writeString(header, 0, name, 100);

  // File mode (100-107) — 0644
  writeString(header, 100, "0000644\0", 8);

  // Owner/group IDs (108-123) — 0
  writeString(header, 108, "0000000\0", 8);
  writeString(header, 116, "0000000\0", 8);

  // File size in octal (124-135)
  writeString(header, 124, size.toString(8).padStart(11, "0") + "\0", 12);

  // Modification time (136-147) — current time
  const mtime = Math.floor(Date.now() / 1000);
  writeString(header, 136, mtime.toString(8).padStart(11, "0") + "\0", 12);

  // Type flag (156) — '0' for regular file
  header[156] = 0x30;

  // USTAR magic (257-264)
  writeString(header, 257, "ustar\0", 6);
  writeString(header, 263, "00", 2);

  // Compute checksum
  // First fill checksum field with spaces (per POSIX spec)
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  writeString(header, 148, checksum.toString(8).padStart(6, "0") + "\0 ", 8);

  return header;
}

function writeString(
  buf: Uint8Array,
  offset: number,
  str: string,
  len: number,
): void {
  const bytes = new TextEncoder().encode(str);
  buf.set(bytes.subarray(0, len), offset);
}
