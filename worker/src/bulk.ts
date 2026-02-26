import { createTarGz } from "./tar";

const MAX_INTERVALS = 288;

interface TarEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Build a tar.gz archive of all files under the given R2 prefix.
 *
 * Sub-directories whose names parse as integers are treated as "intervals".
 * Optional `from` / `to` query-params (integer epoch seconds) filter which
 * intervals are included.  A maximum of 288 intervals is enforced.
 *
 * @param url       The incoming request URL (used to read `from` / `to` query params)
 * @param bucket    R2 bucket
 * @param prefix    Directory prefix including trailing slash, e.g. `btc-updown-5m/`
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

  let prefixes = allDelimitedPrefixes.filter((p) => {
    const parts = p.split("/").filter(Boolean);
    const subDir = parts[prefixParts.length];
    return subDir !== undefined && /^\d+$/.test(subDir);
  });

  // Apply epoch filter if from/to are provided
  if (from !== null && to !== null) {
    prefixes = prefixes.filter((p) => {
      const parts = p.split("/").filter(Boolean);
      const epoch = parseInt(parts[prefixParts.length], 10);
      return epoch >= from! && epoch <= to!;
    });
  }

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

  for (const intervalPrefix of prefixes) {
    let cursor: string | undefined;
    do {
      const result = await bucket.list({ prefix: intervalPrefix, cursor });
      for (const obj of result.objects) {
        const body = await bucket.get(obj.key);
        if (!body) continue;
        const data = new Uint8Array(await body.arrayBuffer());
        // Relative path strips the requested prefix
        const relativePath = obj.key.slice(prefix.length);
        entries.push({ name: relativePath, data });
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }

  if (entries.length === 0) {
    return jsonError("not_found", "No files found in matching intervals", 404);
  }

  const archive = await createTarGz(entries);

  // Build filename: use prefix name (replacing slashes with dashes), optionally with range
  const pathLabel = prefix.replace(/\/$/, "").replace(/\//g, "-");
  const filename = from !== null && to !== null
    ? `${pathLabel}_${from}_${to}.tar.gz`
    : `${pathLabel}.tar.gz`;

  return new Response(archive, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
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
