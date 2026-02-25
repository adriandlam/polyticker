import { createTarGz } from "./tar";

interface TarEntry {
  name: string;
  data: Uint8Array;
}

export async function generateDailyArchive(
  bucket: R2Bucket,
  market: string,
  date: string // YYYY-MM-DD
): Promise<Blob | null> {
  const dayStart = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
  const dayEnd = dayStart + 86400;

  // List all interval directories for this market
  const listed = await bucket.list({ prefix: `${market}/`, delimiter: "/" });
  const prefixes = listed.delimitedPrefixes || [];

  // Filter to epochs within the target day
  const dayPrefixes = prefixes.filter((p) => {
    const epoch = parseInt(p.split("/")[1], 10);
    return !isNaN(epoch) && epoch >= dayStart && epoch < dayEnd;
  });

  if (dayPrefixes.length === 0) return null;

  // Collect all files for matching intervals
  const entries: TarEntry[] = [];

  for (const prefix of dayPrefixes) {
    let cursor: string | undefined;
    do {
      const result = await bucket.list({ prefix, cursor });

      for (const obj of result.objects) {
        const body = await bucket.get(obj.key);
        if (!body) continue;
        const data = new Uint8Array(await body.arrayBuffer());
        const relativePath = obj.key.slice(`${market}/`.length);
        entries.push({ name: `${date}/${relativePath}`, data });
      }

      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }

  if (entries.length === 0) return null;

  const archive = await createTarGz(entries);
  const archiveKey = `archives/${market}/${date}.tar.gz`;
  await bucket.put(archiveKey, await archive.arrayBuffer());

  return archive;
}
