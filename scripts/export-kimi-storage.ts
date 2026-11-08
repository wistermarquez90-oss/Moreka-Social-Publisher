import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { storage } from "../api/lib/storage";

const output = path.resolve(process.env.EXPORT_DIR || "./var/kimi-storage-export");
let pageToken: string | undefined;
let count = 0;
do {
  const page = await storage.listFiles({ prefix: process.env.EXPORT_PREFIX || "moreka/", delimiter: "", maxKeys: 100, pageToken });
  for (const object of page.objects) {
    const target = path.resolve(output, object.key);
    if (!target.startsWith(`${output}${path.sep}`)) throw new Error(`Unsafe key: ${object.key}`);
    const bytes = await storage.readFile({ fileKey: object.key });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    count += 1;
    console.log(`${count}: ${object.key}`);
  }
  pageToken = page.nextPageToken;
} while (pageToken);
console.log(`Export completed: ${count} files in ${output}`);
