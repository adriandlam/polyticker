import { handleArchiveRequest } from "./bulk";

interface Env {
  BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname).slice(1); // strip leading /

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError("method_not_allowed", "Only GET and HEAD requests are supported", 405);
    }

    // Directory listing
    if (path === "" || path.endsWith("/")) {
      if (wantsGzip(request)) {
        return cors(await handleArchiveRequest(url, env.BUCKET, path));
      }
      const data = await listDirectoryData(env.BUCKET, path);
      if (wantsHtml(request)) {
        return cors(renderHtml(data));
      }
      return cors(
        new Response(JSON.stringify(data), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        })
      );
    }

    // File serving
    const object = await env.BUCKET.get(path);
    if (!object) {
      // Path might be a directory without trailing slash — try listing it
      const probe = await env.BUCKET.list({ prefix: path + "/", delimiter: "/", limit: 1 });
      if (probe.objects.length > 0 || (probe.delimitedPrefixes || []).length > 0) {
        return Response.redirect(new URL(url.pathname + "/", url.origin).toString(), 301);
      }
      return jsonError("not_found", "Object not found", 404);
    }

    return cors(
      new Response(object.body, {
        headers: {
          "Content-Type": contentType(path),
          "Content-Length": object.size.toString(),
          "Cache-Control": "public, max-age=86400",
        },
      })
    );
  },
} satisfies ExportedHandler<Env>;

async function listDirectoryData(bucket: R2Bucket, prefix: string) {
  const listed = await bucket.list({ prefix, delimiter: "/" });

  const directories = (listed.delimitedPrefixes || []).map((p) => ({
    name: p.slice(prefix.length).replace(/\/$/, ""),
    path: `/${p}`,
  }));

  const files = listed.objects.map((obj) => ({
    name: obj.key.slice(prefix.length),
    path: `/${obj.key}`,
    size: obj.size,
  }));

  return { path: `/${prefix}`, directories, files };
}

function renderHtml(data: {
  path: string;
  directories: { name: string; path: string }[];
  files: { name: string; path: string; size: number }[];
}): Response {
  const prefix = data.path.slice(1); // strip leading /

  const dirs = data.directories.map(
    (d) => `<li><a href="${d.path}">${d.name}/</a></li>`
  );

  const files = data.files.map(
    (f) =>
      `<li><a href="${f.path}">${f.name}</a> <span>${formatSize(f.size)}</span></li>`
  );

  const parent = prefix
    ? `<li><a href="/${prefix.split("/").slice(0, -2).join("/") + (prefix.split("/").length > 2 ? "/" : "")}">..</a></li>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>polyticker/${prefix}</title>
  <style>
    body { font-family: monospace; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #0a0a0a; color: #e0e0e0; }
    h1 { font-size: 1.2rem; color: #fff; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.3rem 0; display: flex; justify-content: space-between; border-bottom: 1px solid #1a1a1a; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    span { color: #888; }
  </style>
</head>
<body>
  <h1>polyticker/${prefix}</h1>
  <ul>${parent}${dirs.join("")}${files.join("")}</ul>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function wantsGzip(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/gzip");
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("text/html");
}

function contentType(key: string): string {
  if (key.endsWith(".tar.gz")) return "application/gzip";
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".jsonl")) return "application/x-ndjson";
  return "application/octet-stream";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cors(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

function jsonError(error: string, message: string, status: number): Response {
  return cors(
    new Response(JSON.stringify({ error, message, status }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}
