import { isIP } from "node:net";

export function assertPublicHttpsUrl(value: string, label = "La URL"): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} no es válida.`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} debe ser HTTPS pública, sin credenciales incrustadas.`);
  const host = url.hostname.toLowerCase();
  const blocked = host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal";
  if (blocked || (isIP(host) && /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(host))) {
    throw new Error(`${label} no puede apuntar a una red privada.`);
  }
  return url;
}

export async function validatePublicVideoUrl(value: string): Promise<string> {
  const url = assertPublicHttpsUrl(value, "El enlace del video");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow", signal: controller.signal });
    }
    if (!response.ok) throw new Error("No fue posible acceder al video; revisa que el enlace sea público.");
    const type = response.headers.get("content-type")?.toLowerCase() || "";
    if (!type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)(?:$|\?)/i.test(url.href)) {
      throw new Error("El enlace debe abrir directamente un archivo de video, no una página o carpeta.");
    }
    return url.href;
  } finally {
    clearTimeout(timeout);
  }
}
