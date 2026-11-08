import { and, eq } from "drizzle-orm";
import { socialConnections, type SocialConnection, type User } from "@db/schema";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import { decryptSecret, encryptSecret } from "./secrets";
import type { OAuthState } from "./oauth-state";
export { createOAuthState, verifyOAuthState } from "./oauth-state";

export const OAUTH_NETWORKS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type OAuthNetwork = typeof OAUTH_NETWORKS[number];
const META_API = "https://graph.facebook.com/v26.0";

type TokenSet = { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes?: string | null; accountId?: string | null; accountName?: string | null; providerData?: Record<string, unknown> };

function publicRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const firstHeader = (name: string) => request.headers.get(name)?.split(",")[0]?.trim().toLowerCase();
  const host = firstHeader("x-forwarded-host") || requestUrl.host;
  const reportedProtocol = firstHeader("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
  const isLocalHost = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])(?::\d+)?$/.test(host) || /(?:\.local|\.internal|\.fcapp\.run)(?::\d+)?$/.test(host);
  // Los proveedores OAuth exigen HTTPS público aunque el proxy interno informe HTTP.
  const protocol = isLocalHost ? reportedProtocol : "https";
  if (protocol !== "https" && protocol !== "http") return requestUrl.origin;
  try {
    const candidate = new URL(`${protocol}://${host}`);
    if (candidate.username || candidate.password || candidate.pathname !== "/" || candidate.search || candidate.hash) return requestUrl.origin;
    return candidate.origin;
  } catch {
    return requestUrl.origin;
  }
}

export function oauthRedirectUri(request: Request) {
  const configured = env.publicAppUrl && env.publicAppUrl !== "http://localhost:3000" ? env.publicAppUrl : publicRequestOrigin(request);
  return `${configured.replace(/\/$/, "")}/api/social/oauth/callback`;
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok || data?.error) {
    const message = data?.error?.message || data?.error_description || data?.error?.error_msg || `HTTP ${response.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data || {};
}

async function getJson(url: string, token?: string) {
  return responseJson(await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(20_000) }));
}

async function postForm(url: string, body: Record<string, string>) {
  return responseJson(await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(25_000) }));
}

function connectionSecrets(connection: SocialConnection) {
  if (!connection.clientId || !connection.clientSecretSecret) throw new Error("Guarda el ID y el secreto de la aplicación antes de conectar.");
  return { clientId: connection.clientId, clientSecret: decryptSecret(connection.clientSecretSecret) };
}

export function authorizationUrl(connection: SocialConnection, network: OAuthNetwork, request: Request, state: string) {
  const { clientId } = connectionSecrets(connection);
  const redirectUri = oauthRedirectUri(request);
  if (network === "instagram" || network === "facebook") {
    const scopes = network === "facebook"
      ? "pages_show_list,pages_read_engagement,pages_manage_posts"
      : "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish";
    const url = new URL(`${META_API}/oauth/authorize`);
    // Meta conserva el diálogo en facebook.com aunque las llamadas Graph usen la versión actual.
    url.href = `https://www.facebook.com/v26.0/dialog/oauth`;
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes);
    url.searchParams.set("state", state);
    return url.toString();
  }
  if (network === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user.info.basic,video.publish");
    url.searchParams.set("state", state);
    return url.toString();
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
  url.searchParams.set("state", state);
  return url.toString();
}

function expiry(seconds: unknown, fallbackSeconds = 3600) {
  const value = Number(seconds);
  return new Date(Date.now() + (Number.isFinite(value) && value > 0 ? value : fallbackSeconds) * 1000);
}

async function exchangeMeta(connection: SocialConnection, code: string, request: Request): Promise<TokenSet> {
  const { clientId, clientSecret } = connectionSecrets(connection);
  const query = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: oauthRedirectUri(request), code });
  const short = await getJson(`${META_API}/oauth/access_token?${query}`);
  const longQuery = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: short.access_token });
  const long = await getJson(`${META_API}/oauth/access_token?${longQuery}`).catch(() => short);
  const userToken = long.access_token as string;
  const pages = await getJson(`${META_API}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`);
  const page = pages.data?.find((item: any) => !connection.accountId || item.id === connection.accountId) || pages.data?.[0];
  if (!page) throw new Error("La cuenta autorizada no administra ninguna Página de Facebook disponible.");
  if (connection.network === "facebook") {
    return { accessToken: page.access_token, refreshToken: null, expiresAt: expiry(long.expires_in, 60 * 86400), scopes: connection.scopes, accountId: page.id, accountName: page.name, providerData: { pageId: page.id, pageName: page.name } };
  }
  const detail = await getJson(`${META_API}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`);
  const instagram = detail.instagram_business_account;
  if (!instagram) throw new Error(`La Página «${page.name}» no tiene una cuenta profesional de Instagram vinculada.`);
  return { accessToken: userToken, refreshToken: null, expiresAt: expiry(long.expires_in, 60 * 86400), accountId: instagram.id, accountName: instagram.username || page.name, providerData: { pageId: page.id, pageName: page.name, instagramUsername: instagram.username || null } };
}

async function exchangeTikTok(connection: SocialConnection, code: string, request: Request): Promise<TokenSet> {
  const { clientId, clientSecret } = connectionSecrets(connection);
  const token = await postForm("https://open.tiktokapis.com/v2/oauth/token/", { client_key: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: oauthRedirectUri(request) });
  const accessToken = token.access_token as string;
  let profile: any = {};
  try {
    const result = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url", accessToken);
    profile = result.data?.user || {};
  } catch { /* El permiso de publicación sigue siendo utilizable aunque el perfil no responda. */ }
  return { accessToken, refreshToken: token.refresh_token || null, expiresAt: expiry(token.expires_in, 86400), scopes: token.scope || "user.info.basic,video.publish", accountId: token.open_id || profile.open_id || null, accountName: profile.display_name || profile.username || connection.accountName, providerData: { username: profile.username || null, avatarUrl: profile.avatar_url || null } };
}

async function exchangeYouTube(connection: SocialConnection, code: string, request: Request): Promise<TokenSet> {
  const { clientId, clientSecret } = connectionSecrets(connection);
  const token = await postForm("https://oauth2.googleapis.com/token", { client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: oauthRedirectUri(request) });
  const accessToken = token.access_token as string;
  const channels = await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", accessToken);
  const channel = channels.items?.find((item: any) => !connection.accountId || item.id === connection.accountId) || channels.items?.[0];
  if (!channel) throw new Error("La cuenta de Google no tiene un canal de YouTube disponible.");
  return { accessToken, refreshToken: token.refresh_token || (connection.refreshTokenSecret ? decryptSecret(connection.refreshTokenSecret) : null), expiresAt: expiry(token.expires_in), scopes: token.scope || null, accountId: channel.id, accountName: channel.snippet?.title || connection.accountName, providerData: { channelTitle: channel.snippet?.title || null, customUrl: channel.snippet?.customUrl || null } };
}

export async function completeOAuth(connection: SocialConnection, code: string, request: Request) {
  const tokens = connection.network === "tiktok" ? await exchangeTikTok(connection, code, request)
    : connection.network === "youtube" ? await exchangeYouTube(connection, code, request)
      : await exchangeMeta(connection, code, request);
  await getDb().update(socialConnections).set({
    connectionMode: "oauth",
    status: "connected",
    accountName: tokens.accountName || connection.accountName,
    accountId: tokens.accountId || null,
    accessTokenSecret: encryptSecret(tokens.accessToken),
    refreshTokenSecret: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : connection.refreshTokenSecret,
    expiresAt: tokens.expiresAt || null,
    scopes: tokens.scopes || connection.scopes,
    providerDataJson: tokens.providerData ? JSON.stringify(tokens.providerData) : connection.providerDataJson,
    endpointSecret: null,
    lastCheckedAt: new Date(),
    lastError: null,
  }).where(eq(socialConnections.id, connection.id));
}

export async function getNativeAccessToken(connection: SocialConnection) {
  if (!connection.accessTokenSecret) throw new Error("Autoriza la cuenta oficial antes de publicar.");
  const shouldRefresh = connection.refreshTokenSecret && (!connection.expiresAt || connection.expiresAt.getTime() < Date.now() + 60_000);
  if (!shouldRefresh) return decryptSecret(connection.accessTokenSecret);
  const { clientId, clientSecret } = connectionSecrets(connection);
  const refreshToken = decryptSecret(connection.refreshTokenSecret!);
  const token = connection.network === "tiktok"
    ? await postForm("https://open.tiktokapis.com/v2/oauth/token/", { client_key: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken })
    : connection.network === "youtube"
      ? await postForm("https://oauth2.googleapis.com/token", { client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken })
      : null;
  if (!token) return decryptSecret(connection.accessTokenSecret);
  await getDb().update(socialConnections).set({
    accessTokenSecret: encryptSecret(token.access_token),
    refreshTokenSecret: token.refresh_token ? encryptSecret(token.refresh_token) : connection.refreshTokenSecret,
    expiresAt: expiry(token.expires_in),
    lastError: null,
  }).where(eq(socialConnections.id, connection.id));
  return token.access_token as string;
}

export async function checkNativeConnection(connection: SocialConnection) {
  const token = await getNativeAccessToken(connection);
  if (!connection.accountId) throw new Error("La conexión no tiene un ID de cuenta; vuelve a autorizarla.");
  let providerData: Record<string, unknown> = {};
  try { providerData = connection.providerDataJson ? JSON.parse(connection.providerDataJson) : {}; } catch { providerData = {}; }
  if (connection.network === "tiktok") {
    const result = await responseJson(await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" }, signal: AbortSignal.timeout(20_000) }));
    const creator = result.data || {};
    providerData = { ...providerData, privacyLevelOptions: creator.privacy_level_options || [], maxVideoPostDurationSec: creator.max_video_post_duration_sec || null };
  } else if (connection.network === "youtube") {
    await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", token);
  } else {
    const fields = connection.network === "instagram" ? "id,username" : "id,name";
    await getJson(`${META_API}/${connection.accountId}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
  }
  await getDb().update(socialConnections).set({ status: "connected", providerDataJson: JSON.stringify(providerData), lastCheckedAt: new Date(), lastError: null }).where(eq(socialConnections.id, connection.id));
}

export async function findConnectionForCallback(state: OAuthState, user: User) {
  if (user.role !== "admin" || user.id !== state.userId || user.activeOrganizationId !== state.organizationId) throw new Error("La sesión o la empresa cambiaron durante la autorización. Vuelve a intentarlo.");
  const connection = await getDb().query.socialConnections.findFirst({ where: and(eq(socialConnections.organizationId, state.organizationId), eq(socialConnections.network, state.network)) });
  if (!connection) throw new Error("No se encontró la configuración de la red.");
  return connection;
}
