import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { Session } from "@contracts/constants";
import { emailSettings, users } from "@db/schema";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, adminQuery, publicQuery } from "./middleware";
import { env } from "./lib/env";
import { hashPassword, loginExternal } from "./services/auth";
import { signSessionToken } from "./kimi/session";
import { getDb } from "./queries/connection";
import { currentOrganization } from "./services/organizations";
import { encryptSecret } from "./services/secrets";
import { requestRecovery, resetPassword, sendTestEmail } from "./services/recovery-email";

const attempts = new Map<string, { count: number; resetAt: number }>();
const email = z.string().trim().email().max(320);
const password = z.string().min(8).max(256);

function rateLimit(ctx: { req: Request }, value: string) {
  const ip = ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${ip}:${value.toLowerCase()}`;
  const current = attempts.get(key);
  if (current && current.resetAt > Date.now() && current.count >= 8) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Demasiados intentos. Espera 15 minutos." });
  return { key, current };
}

export const authRouter = createRouter({
  config: publicQuery.query(async () => {
    const configured = await getDb().select({ id: users.id }).from(users).where(isNotNull(users.passwordHash)).limit(1);
    return { driver: env.authDriver, passwordEnabled: configured.length > 0 || env.authDriver === "password" };
  }),
  login: publicQuery.input(z.object({ email, password })).mutation(async ({ ctx, input }) => {
    const { key, current } = rateLimit(ctx, input.email);
    try {
      const { token } = await loginExternal(input.email, input.password);
      attempts.delete(key);
      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append("set-cookie", cookie.serialize(Session.cookieName, token, { httpOnly: opts.httpOnly, path: opts.path, sameSite: opts.sameSite?.toLowerCase() as "lax" | "none", secure: opts.secure, maxAge: 60 * 60 * 24 * 30 }));
      return { success: true };
    } catch {
      const state = current && current.resetAt > Date.now() ? current : { count: 0, resetAt: Date.now() + 15 * 60_000 };
      attempts.set(key, { ...state, count: state.count + 1 });
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Correo o contraseña incorrectos." });
    }
  }),
  recover: publicQuery.input(z.object({ email })).mutation(async ({ ctx, input }) => {
    const { key, current } = rateLimit(ctx, `recovery:${input.email}`);
    const state = current && current.resetAt > Date.now() ? current : { count: 0, resetAt: Date.now() + 15 * 60_000 };
    attempts.set(key, { ...state, count: state.count + 1 });
    return requestRecovery(input.email, ctx.req);
  }),
  reset: publicQuery.input(z.object({ email, token: z.string().min(20).max(200), password })).mutation(async ({ input }) => resetPassword(input.email, input.token, input.password)),
  access: adminQuery.query(async ({ ctx }) => {
    const organization = await currentOrganization(ctx.user);
    const settings = await getDb().query.emailSettings.findFirst({ where: eq(emailSettings.organizationId, organization.id) });
    return {
      email: ctx.user.email,
      hasPassword: Boolean(ctx.user.passwordHash),
      smtp: settings ? { host: settings.host, port: settings.port, secure: settings.secure, username: settings.username, fromEmail: settings.fromEmail, fromName: settings.fromName, hasPassword: true, verifiedAt: settings.verifiedAt, lastError: settings.lastError } : null,
    };
  }),
  setupPassword: adminQuery.input(z.object({ email, password })).mutation(async ({ ctx, input }) => {
    const normalized = input.email.toLowerCase();
    const existing = await getDb().query.users.findFirst({ where: and(eq(users.email, normalized), eq(users.id, ctx.user.id)) });
    const duplicate = await getDb().query.users.findFirst({ where: eq(users.email, normalized) });
    if (duplicate && duplicate.id !== ctx.user.id) throw new Error("Ese correo ya está asociado a otra cuenta.");
    const passwordHash = await hashPassword(input.password);
    await getDb().update(users).set({ email: normalized, passwordHash, passwordChangedAt: new Date(), accessStatus: "active", recoveryTokenHash: null, recoveryTokenExpiresAt: null }).where(eq(users.id, ctx.user.id));
    const token = await signSessionToken({ unionId: ctx.user.unionId, clientId: "external" });
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append("set-cookie", cookie.serialize(Session.cookieName, token, { httpOnly: opts.httpOnly, path: opts.path, sameSite: opts.sameSite?.toLowerCase() as "lax" | "none", secure: opts.secure, maxAge: 60 * 60 * 24 * 30 }));
    return { ok: true, hadPrevious: Boolean(existing) };
  }),
  saveSmtp: adminQuery.input(z.object({
    host: z.string().trim().min(2).max(255),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().trim().min(2).max(320),
    password: z.string().max(1000).or(z.literal("")),
    fromEmail: email,
    fromName: z.string().trim().min(2).max(255),
  })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const existing = await getDb().query.emailSettings.findFirst({ where: eq(emailSettings.organizationId, organization.id) });
    if (!input.password && !existing?.passwordSecret) throw new Error("Agrega la contraseña o clave de aplicación SMTP.");
    const values = { organizationId: organization.id, host: input.host, port: input.port, secure: input.secure, username: input.username, passwordSecret: input.password ? encryptSecret(input.password) : existing!.passwordSecret, fromEmail: input.fromEmail.toLowerCase(), fromName: input.fromName, verifiedAt: null, lastError: null };
    if (existing) await getDb().update(emailSettings).set(values).where(eq(emailSettings.id, existing.id));
    else await getDb().insert(emailSettings).values(values);
    return { ok: true };
  }),
  testSmtp: adminQuery.mutation(async ({ ctx }) => {
    const organization = await currentOrganization(ctx.user);
    const settings = await getDb().query.emailSettings.findFirst({ where: eq(emailSettings.organizationId, organization.id) });
    if (!settings) throw new Error("Guarda primero la configuración SMTP.");
    const recipient = ctx.user.email || settings.fromEmail;
    try {
      await sendTestEmail(settings, recipient);
      await getDb().update(emailSettings).set({ verifiedAt: new Date(), lastError: null }).where(eq(emailSettings.id, settings.id));
      return { ok: true, recipient };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await getDb().update(emailSettings).set({ verifiedAt: null, lastError: message }).where(eq(emailSettings.id, settings.id));
      throw new Error(`No se pudo verificar el correo: ${message}`);
    }
  }),
  me: authedQuery.query((opts) => opts.ctx.user),
  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append("set-cookie", cookie.serialize(Session.cookieName, "", { httpOnly: opts.httpOnly, path: opts.path, sameSite: opts.sameSite?.toLowerCase() as "lax" | "none", secure: opts.secure, maxAge: 0 }));
    return { success: true };
  }),
});
