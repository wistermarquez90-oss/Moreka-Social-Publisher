import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { socialConnections } from "@db/schema";
import { env } from "../lib/env";
import { authenticateRequest } from "../kimi/auth";
import { authenticateExternal } from "../services/auth";
import { completeOAuth, findConnectionForCallback, verifyOAuthState } from "../services/social-oauth";
import { getDb } from "../queries/connection";

export const socialOAuthRoutes = new Hono();

socialOAuthRoutes.get("/callback", async (c) => {
  const stateValue = c.req.query("state");
  const providerErrorCode = c.req.query("error") || c.req.query("error_code");
  if (!stateValue && providerErrorCode) {
    const detail = c.req.query("error_description") || c.req.query("error_message") || "El proveedor rechazó la autorización antes de completar el retorno.";
    const message = `El proveedor informó un error (${providerErrorCode}): ${detail}`;
    return c.redirect(`/configuracion?oauth=error&message=${encodeURIComponent(message.slice(0, 500))}`, 302);
  }
  if (!stateValue) return c.json({ error: "Falta el estado OAuth." }, 400);
  let connectionId: number | null = null;
  try {
    const state = verifyOAuthState(stateValue);
    const user = env.authDriver === "password" ? await authenticateExternal(c.req.raw.headers) : await authenticateRequest(c.req.raw.headers);
    if (!user) throw new Error("Tu sesión expiró. Inicia sesión y repite la conexión.");
    const connection = await findConnectionForCallback(state, user);
    connectionId = connection.id;
    const providerError = c.req.query("error");
    if (providerError) throw new Error(c.req.query("error_description") || `La autorización fue cancelada (${providerError}).`);
    const code = c.req.query("code");
    if (!code) throw new Error("El proveedor no devolvió un código de autorización.");
    await completeOAuth(connection, code, c.req.raw);
    return c.redirect(`/configuracion?oauth=connected&network=${state.network}`, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la autorización.";
    if (connectionId) await getDb().update(socialConnections).set({ status: "error", lastCheckedAt: new Date(), lastError: message }).where(eq(socialConnections.id, connectionId));
    return c.redirect(`/configuracion?oauth=error&message=${encodeURIComponent(message.slice(0, 500))}`, 302);
  }
});
