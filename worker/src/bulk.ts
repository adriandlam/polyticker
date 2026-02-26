import { createTarGz } from "./tar";

const MAX_INTERVALS = 288;

interface TarEntry {
  name: string;
  data: Uint8Array;
}

export async function handleBulkDownload(
  url: URL,
  bucket: R2Bucket,
  market: string
): Promise<Response> {
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  if (!fromStr || !toStr) {
    return jsonError("bad_request", "Both 'from' and 'to' query parameters are required", 400);
  }

  const from = Number(fromStr);
  const to = Number(toStr);

  if (isNaN(from) || isNaN(to) || !Number.isInteger(from) || !Number.isInteger(to)) {
    return jsonError("bad_request", "'from' and 'to' must be integer epoch timestamps", 400);
  }

  if (from > to) {
    return jsonError("bad_request", "'from' must be less than or equal to 'to'", 400);
  }

  // List all interval directories for this market
  const listed = await bucket.list({ prefix: `${market}/`, delimiter: "/" });
  const prefixes = (listed.delimitedPrefixes || []).filter((p) => {
    const epoch = parseInt(p.split("/")[1], 10);
    return !isNaN(epoch) && epoch >= from && epoch <= to;
  });

  if (prefixes.length === 0) {
    return jsonError("not_found", "No intervals found in the specified range", 404);
  }

  if (prefixes.length > MAX_INTERVALS) {
    return jsonError(
      "range_too_large",
      `Range contains ${prefixes.length} intervals, max is ${MAX_INTERVALS}. Narrow your from/to range.`,
      413
    );
  }

  // Collect all files for matching intervals
  const entries: TarEntry[] = [];

  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const result = await bucket.list({ prefix, cursor });
      for (const obj of result.objects) {
        const body = await bucket.get(obj.key);
        if (!body) continue;
        const data = new Uint8Array(await body.arrayBuffer());
        const relativePath = obj.key.slice(`${market}/`.length);
        entries.push({ name: relativePath, data });
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }

  if (entries.length === 0) {
    return jsonError("not_found", "No files found in matching intervals", 404);
  }

  const archive = await createTarGz(entries);

  return new Response(archive, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${market}_${from}_${to}.tar.gz"`,
      "Content-Length": archive.size.toString(),
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
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
