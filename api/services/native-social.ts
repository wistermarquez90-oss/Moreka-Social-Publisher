import type { SocialConnection, ScheduledPost } from "@db/schema";
import type { ScheduledNetworkPayload, ScheduledPayload } from "@contracts/publishing";
import { getNativeAccessToken } from "./social-oauth";

const META_API = "https://graph.facebook.com/v26.0";
export type NativePublishResult = { externalPostId: string | null; externalUrl: string | null };
type PublishInput = { connection: SocialConnection; schedule: ScheduledPost; item: ScheduledNetworkPayload; mediaUrl: string | null; payload: ScheduledPayload };

async function jsonResponse(response: Response) {
  const data = await response.json().catch(() => null) as any;
  if (!response.ok || (data?.error && data.error.code !== "ok")) {
    const message = data?.error?.message || data?.error_description || data?.message || `HTTP ${response.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data || {};
}

async function metaPost(path: string, token: string, values: Record<string, string>) {
  return jsonResponse(await fetch(`${META_API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...values, access_token: token }),
    signal: AbortSignal.timeout(45_000),
  }));
}

async function metaGet(path: string, token: string) {
  const separator = path.includes("?") ? "&" : "?";
  return jsonResponse(await fetch(`${META_API}${path}${separator}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(30_000) }));
}

function captionFor(item: ScheduledNetworkPayload) {
  return `${item.caption}${item.hashtags ? `\n\n${item.hashtags}` : ""}`;
}

function requireMedia(value: string | null | undefined, label: string) {
  if (!value) throw new Error(`Falta ${label}; no se enviará una publicación incompleta.`);
  return value;
}

async function waitForInstagramContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await metaGet(`/${containerId}?fields=status_code,status`, token);
    if (result.status_code === "FINISHED" || result.status_code === "PUBLISHED") return;
    if (["ERROR", "EXPIRED"].includes(result.status_code)) throw new Error(result.status || `Instagram no pudo procesar el recurso (${result.status_code}).`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Instagram sigue procesando el recurso. No se reintentará automáticamente para evitar duplicados.");
}

async function publishInstagram(input: PublishInput, token: string): Promise<NativePublishResult> {
  const accountId = requireMedia(input.connection.accountId, "el ID profesional de Instagram");
  const format = input.schedule.format;
  const values: Record<string, string> = {};
  if (format === "story") values.media_type = "STORIES";
  if (format === "reel") { values.media_type = "REELS"; values.share_to_feed = "true"; }
  if (format === "reel" || (format === "story" && input.schedule.videoUrl)) values.video_url = requireMedia(input.schedule.videoUrl, "el video público");
  else values.image_url = requireMedia(input.mediaUrl, "la imagen pública");
  if (format !== "story") values.caption = captionFor(input.item);
  const container = await metaPost(`/${accountId}/media`, token, values);
  const containerId = requireMedia(container.id, "el contenedor de Instagram");
  await waitForInstagramContainer(containerId, token);
  const published = await metaPost(`/${accountId}/media_publish`, token, { creation_id: containerId });
  const id = requireMedia(published.id, "la confirmación de Instagram");
  let externalUrl: string | null = null;
  try { externalUrl = (await metaGet(`/${id}?fields=permalink`, token)).permalink || null; } catch { /* El ID ya confirma la publicación. */ }
  return { externalPostId: id, externalUrl };
}

async function publishFacebookReel(input: PublishInput, token: string, story = false): Promise<NativePublishResult> {
  const pageId = requireMedia(input.connection.accountId, "el ID de la Página");
  const edge = story ? "video_stories" : "video_reels";
  const started = await metaPost(`/${pageId}/${edge}`, token, { upload_phase: "start" });
  const videoId = requireMedia(started.video_id, "el ID de video de Facebook");
  const uploadUrl = requireMedia(started.upload_url, "la URL de carga de Facebook");
  await jsonResponse(await fetch(uploadUrl, {
    method: "POST",
    headers: { authorization: `OAuth ${token}`, file_url: requireMedia(input.schedule.videoUrl, "el video público") },
    signal: AbortSignal.timeout(90_000),
  }));
  const finish: Record<string, string> = { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED" };
  if (!story) finish.description = captionFor(input.item);
  const result = await metaPost(`/${pageId}/${edge}`, token, finish);
  if (!result.success) throw new Error("Facebook no confirmó la publicación del video.");
  return { externalPostId: videoId, externalUrl: `https://www.facebook.com/${videoId}` };
}

async function publishFacebook(input: PublishInput, token: string): Promise<NativePublishResult> {
  const pageId = requireMedia(input.connection.accountId, "el ID de la Página");
  if (input.schedule.format === "reel" || (input.schedule.format === "story" && input.schedule.videoUrl)) {
    return publishFacebookReel(input, token, input.schedule.format === "story");
  }
  if (input.schedule.format === "story") {
    const upload = await metaPost(`/${pageId}/photos`, token, { url: requireMedia(input.mediaUrl, "la imagen pública"), published: "false" });
    const photoId = requireMedia(upload.id, "la carga de la historia");
    const result = await metaPost(`/${pageId}/photo_stories`, token, { photo_id: photoId });
    const id = result.post_id || result.id || photoId;
    if (!result.success && !result.post_id && !result.id) throw new Error("Facebook no confirmó la historia.");
    return { externalPostId: id, externalUrl: null };
  }
  const result = await metaPost(`/${pageId}/photos`, token, { url: requireMedia(input.mediaUrl, "la imagen pública"), message: captionFor(input.item) });
  const id = requireMedia(result.post_id || result.id, "la confirmación de Facebook");
  return { externalPostId: id, externalUrl: `https://www.facebook.com/${id}` };
}

async function tiktokPost(path: string, token: string, body?: unknown) {
  return jsonResponse(await fetch(`https://open.tiktokapis.com/v2${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  }));
}

async function publishTikTok(input: PublishInput, token: string): Promise<NativePublishResult> {
  const creator = await tiktokPost("/post/publish/creator_info/query/", token);
  const allowed = creator.data?.privacy_level_options || [];
  const privacyLevel = input.payload.tiktok?.privacyLevel || "SELF_ONLY";
  if (!allowed.includes(privacyLevel)) throw new Error(`TikTok no permite la privacidad ${privacyLevel} en esta cuenta.`);
  const initialized = await tiktokPost("/post/publish/video/init/", token, {
    post_info: {
      title: captionFor(input.item).slice(0, 2200),
      privacy_level: privacyLevel,
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      brand_content_toggle: false,
      brand_organic_toggle: true,
    },
    source_info: { source: "PULL_FROM_URL", video_url: requireMedia(input.schedule.videoUrl, "el video público verificado") },
  });
  const publishId = requireMedia(initialized.data?.publish_id, "el identificador de TikTok");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await tiktokPost("/post/publish/status/fetch/", token, { publish_id: publishId });
    const value = status.data?.status;
    if (value === "PUBLISH_COMPLETE") return { externalPostId: status.data?.publicaly_available_post_id || publishId, externalUrl: null };
    if (value === "FAILED") throw new Error(status.data?.fail_reason || "TikTok rechazó el video durante el procesamiento.");
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("TikTok sigue procesando; no se marcará como publicado ni se reenviará automáticamente.");
}

async function publishYouTube(input: PublishInput, token: string): Promise<NativePublishResult> {
  const videoUrl = requireMedia(input.schedule.videoUrl, "el video público");
  const source = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) });
  if (!source.ok || !source.body) throw new Error(`No se pudo leer el video fuente (HTTP ${source.status}).`);
  const contentType = source.headers.get("content-type") || "video/mp4";
  const contentLength = source.headers.get("content-length");
  const metadata = {
    snippet: { title: input.item.title.slice(0, 100), description: captionFor(input.item).slice(0, 5000), categoryId: "22" },
    status: { privacyStatus: input.payload.youtube?.privacyStatus || "private", selfDeclaredMadeForKids: false },
  };
  const initiation = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": contentType,
      ...(contentLength ? { "x-upload-content-length": contentLength } : {}),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(45_000),
  });
  if (!initiation.ok) {
    const detail = await initiation.text();
    throw new Error(`YouTube rechazó el inicio de la carga: ${detail.slice(0, 500)}`);
  }
  const uploadUrl = initiation.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube no devolvió una URL de carga reanudable.");
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType, ...(contentLength ? { "content-length": contentLength } : {}) },
    body: source.body,
    // Node necesita duplex para transmitir sin cargar el video completo en memoria.
    duplex: "half",
    signal: AbortSignal.timeout(10 * 60_000),
  } as RequestInit & { duplex: "half" });
  const result = await jsonResponse(uploaded);
  const id = requireMedia(result.id, "la confirmación de YouTube");
  return { externalPostId: id, externalUrl: `https://www.youtube.com/watch?v=${id}` };
}

export async function publishNative(input: PublishInput): Promise<NativePublishResult> {
  if (input.connection.network === "linkedin") throw new Error("LinkedIn está fuera del flujo activo.");
  const token = await getNativeAccessToken(input.connection);
  if (input.connection.network === "instagram") return publishInstagram(input, token);
  if (input.connection.network === "facebook") return publishFacebook(input, token);
  if (input.connection.network === "tiktok") return publishTikTok(input, token);
  if (input.connection.network === "youtube") return publishYouTube(input, token);
  throw new Error("Red oficial no soportada.");
}
