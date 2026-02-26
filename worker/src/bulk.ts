const MAX_ARCHIVES = 288;

/**
 * Handle requests for pre-built archives stored in R2.
 *
 * - Single interval (from === to): serve the archive directly from R2
 * - Range (from < to) or no params: return JSON list of archive URLs
 * - Enforces a maximum of 288 archives per request
 */
export async function handleArchiveRequest(
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

  // Strip trailing slash from prefix for consistent key construction
  const market = prefix.replace(/\/$/, "");
  const archivePrefix = `${market}/archives/`;

  // Single interval: serve archive directly
  if (from !== null && to !== null && from === to) {
    const key = `${archivePrefix}${from}.tar.gz`;
    const object = await bucket.get(key);
    if (!object) {
      return jsonError("not_found", "Archive not found", 404);
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${from}.tar.gz"`,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Range or no params: list archives
  const allKeys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: archivePrefix, cursor });
    for (const obj of listed.objects) {
      allKeys.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // Filter to only .tar.gz files and extract epochs
  let archives = allKeys
    .map((key) => {
      const filename = key.slice(archivePrefix.length);
      const match = filename.match(/^(\d+)\.tar\.gz$/);
      if (!match) return null;
      return { epoch: parseInt(match[1], 10), key };
    })
    .filter((a): a is { epoch: number; key: string } => a !== null);

  // Apply range filter if provided
  if (from !== null && to !== null) {
    archives = archives.filter((a) => a.epoch >= from! && a.epoch <= to!);
  }

  if (archives.length === 0) {
    return jsonError("not_found", "No archives found in the specified range", 404);
  }

  if (archives.length > MAX_ARCHIVES) {
    return jsonError(
      "range_too_large",
      `Range contains ${archives.length} archives, max is ${MAX_ARCHIVES}. Narrow your from/to range.`,
      413
    );
  }

  // Sort by epoch
  archives.sort((a, b) => a.epoch - b.epoch);

  const body = {
    archives: archives.map((a) => ({
      epoch: a.epoch,
      url: `/${market}/archives/${a.epoch}.tar.gz`,
    })),
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
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
