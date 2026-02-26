import { tarHeader } from "./tar";

const MAX_INTERVALS = 288;

/**
 * Build a streaming tar.gz archive of all files under the given R2 prefix.
 *
 * Files are streamed one at a time through a tar encoder → gzip compressor,
 * so peak memory is O(largest single file) rather than O(all files).
 *
 * Sub-directories whose names parse as integers are treated as "intervals".
 * Optional `from` / `to` query-params (integer epoch seconds) filter which
 * intervals are included.  A maximum of 288 intervals is enforced.
 */
export async function buildDirectoryTarGz(
  url: URL,
  bucket: R2Bucket,
  prefix: string
): Promise<Response> {
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  // If either from or to is provided, both must be present
  if ((fromStr == null) !== (toStr == null)) {
    return jsonError("bad_request", "Both 'from' and 'to' query parameters are required when filtering by range", 400);
  }

  let from: number | null = null;
  let to: number | null = null;

  if (fromStr != null && toStr != null) {
    from = Number(fromStr);
    to = Number(toStr);

    if (isNaN(from) || isNaN(to) || !Number.isInteger(from) || !Number.isInteger(to)) {
      return jsonError("bad_request", "'from' and 'to' must be integer epoch timestamps", 400);
    }

    if (from > to) {
      return jsonError("bad_request", "'from' must be less than or equal to 'to'", 400);
    }
  }

  // List all sub-directory prefixes under the given prefix (paginated)
  const allDelimitedPrefixes: string[] = [];
  let listCursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, delimiter: "/", cursor: listCursor });
    allDelimitedPrefixes.push(...(listed.delimitedPrefixes || []));
    listCursor = listed.truncated ? listed.cursor : undefined;
  } while (listCursor);

  // Determine the depth of the prefix so we can extract the sub-directory name
  const prefixParts = prefix.split("/").filter(Boolean);

  let intervalPrefixes = allDelimitedPrefixes.filter((p) => {
    const parts = p.split("/").filter(Boolean);
    const subDir = parts[prefixParts.length];
    return subDir !== undefined && /^\d+$/.test(subDir);
  });

  if (intervalPrefixes.length > 0) {
    // Interval mode: directory contains numeric sub-dirs (e.g. btc-updown-5m/)
    if (from !== null && to !== null) {
      intervalPrefixes = intervalPrefixes.filter((p) => {
        const parts = p.split("/").filter(Boolean);
        const epoch = parseInt(parts[prefixParts.length], 10);
        return epoch >= from! && epoch <= to!;
      });
    }

    if (intervalPrefixes.length === 0) {
      return jsonError("not_found", "No intervals found in the specified range", 404);
    }

    if (intervalPrefixes.length > MAX_INTERVALS) {
      return jsonError(
        "range_too_large",
        `Range contains ${intervalPrefixes.length} intervals, max is ${MAX_INTERVALS}. Narrow your from/to range.`,
        413
      );
    }

    return streamTarGz(bucket, prefix, intervalPrefixes, from, to);
  }

  // Direct mode: directory has no numeric sub-dirs (e.g. btc-updown-5m/1740441600/)
  // Check that files actually exist before starting the stream
  const probe = await bucket.list({ prefix, limit: 1 });
  if (probe.objects.length === 0) {
    return jsonError("not_found", "No files found in matching intervals", 404);
  }

  return streamTarGz(bucket, prefix, [prefix], from, to);
}

/**
 * Stream tar entries from R2 through gzip compression.
 * Each file is fetched, written to the tar stream, then released from memory.
 */
function streamTarGz(
  bucket: R2Bucket,
  prefix: string,
  prefixes: string[],
  from: number | null,
  to: number | null
): Response {
  const { readable, writable } = new TransformStream<Uint8Array>();

  // Build filename
  const pathLabel = prefix.replace(/\/$/, "").replace(/\//g, "-");
  const filename = from !== null && to !== null
    ? `${pathLabel}_${from}_${to}.tar.gz`
    : `${pathLabel}.tar.gz`;

  // Kick off async tar generation (runs in background, writes to stream)
  const writePromise = writeTarEntries(bucket, prefix, prefixes, writable);

  // Pipe the raw tar stream through gzip compression
  const compressed = readable.pipeThrough(new CompressionStream("gzip"));

  // Attach error handler so unhandled rejection doesn't crash the worker
  writePromise.catch(() => {});

  return new Response(compressed, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function writeTarEntries(
  bucket: R2Bucket,
  prefix: string,
  prefixes: string[],
  writable: WritableStream<Uint8Array>
): Promise<void> {
  const writer = writable.getWriter();
  try {
    for (const p of prefixes) {
      let cursor: string | undefined;
      do {
        const result = await bucket.list({ prefix: p, cursor });
        for (const obj of result.objects) {
          const body = await bucket.get(obj.key);
          if (!body) continue;
          const data = new Uint8Array(await body.arrayBuffer());
          const name = obj.key.slice(prefix.length);
          await writer.write(tarHeader(name, data.length));
          await writer.write(data);
          const remainder = data.length % 512;
          if (remainder > 0) {
            await writer.write(new Uint8Array(512 - remainder));
          }
        }
        cursor = result.truncated ? result.cursor : undefined;
      } while (cursor);
    }
    // End-of-archive: two 512-byte zero blocks
    await writer.write(new Uint8Array(1024));
    await writer.close();
  } catch (e) {
    await writer.abort(e);
  }
}

function jsonError(error: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error, message, status }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
