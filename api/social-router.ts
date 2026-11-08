import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { adminQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { socialConnections } from "@db/schema";
import { currentOrganization } from "./services/organizations";
import { decryptSecret, encryptSecret } from "./services/secrets";
import { assertPublicHttpsUrl } from "./services/public-url";
import { authorizationUrl, checkNativeConnection, createOAuthState, oauthRedirectUri, OAUTH_NETWORKS } from "./services/social-oauth";

const network = z.enum(["instagram", "facebook", "tiktok", "linkedin", "youtube"]);
const nativeNetwork = z.enum(OAUTH_NETWORKS);

function publicConnection<T extends { endpointSecret: string | null; clientSecretSecret: string | null; accessTokenSecret: string | null; refreshTokenSecret: string | null; providerDataJson: string | null }>(connection: T) {
  const { endpointSecret, clientSecretSecret, accessTokenSecret, refreshTokenSecret, providerDataJson, ...safe } = connection;
  let providerData: Record<string, unknown> = {};
  try { providerData = providerDataJson ? JSON.parse(providerDataJson) : {}; } catch { providerData = {}; }
  return { ...safe, providerData, hasEndpoint: Boolean(endpointSecret), hasToken: Boolean(accessTokenSecret), hasClientSecret: Boolean(clientSecretSecret) };
}

export const socialRouter = createRouter({
  connections: adminQuery.query(async ({ ctx }) => {
    const organization = await currentOrganization(ctx.user);
    const rows = await getDb().select().from(socialConnections).where(eq(socialConnections.organizationId, organization.id));
    return rows.map(publicConnection);
  }),
  callbackUrl: adminQuery.query(async ({ ctx }) => ({ url: oauthRedirectUri(ctx.req) })),
  save: adminQuery.input(z.object({
    network,
    accountName: z.string().trim().min(2).max(255),
    accountId: z.string().trim().max(255),
    endpoint: z.string().trim().max(3000).or(z.literal("")),
    token: z.string().trim().max(6000).or(z.literal("")),
  })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const existing = await db.query.socialConnections.findFirst({ where: and(eq(socialConnections.organizationId, organization.id), eq(socialConnections.network, input.network)) });
    if (!input.endpoint && !existing?.endpointSecret) throw new Error("Agrega el endpoint HTTPS del conector.");
    if (input.endpoint) assertPublicHttpsUrl(input.endpoint, "El endpoint");
    const values = {
      organizationId: organization.id,
      network: input.network,
      accountName: input.accountName,
      accountId: input.accountId || null,
      connectionMode: "webhook" as const,
      status: "pending" as const,
      endpointSecret: input.endpoint ? encryptSecret(input.endpoint) : existing?.endpointSecret,
      accessTokenSecret: input.token ? encryptSecret(input.token) : existing?.accessTokenSecret,
      refreshTokenSecret: null,
      lastError: null,
    };
    if (existing) await db.update(socialConnections).set(values).where(eq(socialConnections.id, existing.id));
    else await db.insert(socialConnections).values(values);
    return { ok: true };
  }),
  saveNative: adminQuery.input(z.object({
    network: nativeNetwork,
    accountName: z.string().trim().min(2).max(255),
    accountId: z.string().trim().max(255),
    clientId: z.string().trim().max(512),
    clientSecret: z.string().trim().max(3000).or(z.literal("")),
  })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const existing = await db.query.socialConnections.findFirst({ where: and(eq(socialConnections.organizationId, organization.id), eq(socialConnections.network, input.network)) });
    if (!input.clientId && !existing?.clientId) throw new Error("Agrega el ID de la aplicación oficial.");
    if (!input.clientSecret && !existing?.clientSecretSecret) throw new Error("Agrega el secreto de la aplicación oficial.");
    const values = {
      organizationId: organization.id,
      network: input.network,
      accountName: input.accountName,
      accountId: input.accountId || null,
      connectionMode: "oauth" as const,
      status: "pending" as const,
      clientId: input.clientId || existing?.clientId || null,
      clientSecretSecret: input.clientSecret ? encryptSecret(input.clientSecret) : existing?.clientSecretSecret,
      endpointSecret: null,
      accessTokenSecret: null,
      refreshTokenSecret: null,
      expiresAt: null,
      lastError: null,
    };
    if (existing) await db.update(socialConnections).set(values).where(eq(socialConnections.id, existing.id));
    else await db.insert(socialConnections).values(values);
    return { ok: true };
  }),
  oauthStart: adminQuery.input(z.object({ network: nativeNetwork })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const connection = await getDb().query.socialConnections.findFirst({ where: and(eq(socialConnections.organizationId, organization.id), eq(socialConnections.network, input.network), eq(socialConnections.connectionMode, "oauth")) });
    if (!connection) throw new Error("Guarda primero las credenciales de la aplicación oficial.");
    const state = createOAuthState({ userId: ctx.user.id, organizationId: organization.id, network: input.network });
    return { url: authorizationUrl(connection, input.network, ctx.req, state), redirectUri: new URL(authorizationUrl(connection, input.network, ctx.req, state)).searchParams.get("redirect_uri") };
  }),
  test: adminQuery.input(z.object({ network })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const connection = await db.query.socialConnections.findFirst({ where: and(eq(socialConnections.organizationId, organization.id), eq(socialConnections.network, input.network)) });
    if (!connection) throw new Error("Guarda primero la conexión.");
    try {
      if (connection.connectionMode === "oauth") {
        await checkNativeConnection(connection);
        return { ok: true };
      }
      if (!connection.endpointSecret) throw new Error("Guarda primero el endpoint del conector.");
      const response = await fetch(decryptSecret(connection.endpointSecret), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(connection.accessTokenSecret ? { authorization: `Bearer ${decryptSecret(connection.accessTokenSecret)}` } : {}),
        },
        body: JSON.stringify({ type: "connection.test", network: input.network, organization: organization.slug, timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`El conector respondió HTTP ${response.status}.`);
      await db.update(socialConnections).set({ status: "connected", lastCheckedAt: new Date(), lastError: null }).where(eq(socialConnections.id, connection.id));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(socialConnections).set({ status: "error", lastCheckedAt: new Date(), lastError: message }).where(eq(socialConnections.id, connection.id));
      throw new Error(`No se pudo verificar la conexión: ${message}`);
    }
  }),
  disconnect: adminQuery.input(z.object({ network })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    await getDb().update(socialConnections).set({ status: "disconnected", endpointSecret: null, clientSecretSecret: null, accessTokenSecret: null, refreshTokenSecret: null, expiresAt: null, providerDataJson: null }).where(and(eq(socialConnections.organizationId, organization.id), eq(socialConnections.network, input.network)));
    return { ok: true };
  }),
});
