import { Hono } from "hono";
import { env } from "../lib/env";
import { getObjectStorage, verifyLocalFileSignature } from "../services/object-storage";

const mimeByExtension: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime",
};

export const fileRoutes = new Hono();

fileRoutes.get("/*", async (c) => {
  if (env.storageDriver !== "local") return c.notFound();
  const key = c.req.path.slice("/api/files/".length).split("/").map(decodeURIComponent).join("/");
  const expires = Number(c.req.query("expires"));
  const signature = c.req.query("signature") || "";
  if (!verifyLocalFileSignature(key, expires, signature)) return c.json({ error: "File URL expired or invalid" }, 403);
  try {
    const bytes = await getObjectStorage().readFile({ fileKey: key });
    const extension = key.split(".").pop()?.toLowerCase() || "";
    c.header("Content-Type", mimeByExtension[extension] || "application/octet-stream");
    c.header("Cache-Control", "private, max-age=300");
    if (c.req.query("download")) c.header("Content-Disposition", `attachment; filename="${key.split("/").pop()?.replace(/"/g, "")}"`);
    return c.body(bytes as unknown as ArrayBuffer);
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});
