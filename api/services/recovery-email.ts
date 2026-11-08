import { randomBytes, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { emailSettings, users } from "@db/schema";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import { decryptSecret } from "./secrets";
import { hashPassword } from "./password";
import { tokenHash } from "./recovery-token";

function transport(settings: typeof emailSettings.$inferSelect) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.username, pass: decryptSecret(settings.passwordSecret) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function appOrigin(request: Request) {
  const configured = env.publicAppUrl && env.publicAppUrl !== "http://localhost:3000" ? env.publicAppUrl : new URL(request.url).origin;
  return configured.replace(/\/$/, "");
}

export async function requestRecovery(email: string, request: Request) {
  const normalized = email.trim().toLowerCase();
  const user = await getDb().query.users.findFirst({ where: eq(users.email, normalized) });
  if (!user?.passwordHash) return { accepted: true };
  const settings = await getDb().query.emailSettings.findFirst({ where: eq(emailSettings.organizationId, user.activeOrganizationId || 1) });
  if (!settings?.verifiedAt) throw new Error("La recuperación por correo todavía no está configurada y verificada.");
  const token = randomBytes(32).toString("base64url");
  await getDb().update(users).set({ recoveryTokenHash: tokenHash(token), recoveryTokenExpiresAt: new Date(Date.now() + 30 * 60_000) }).where(eq(users.id, user.id));
  const url = `${appOrigin(request)}/recuperar?token=${encodeURIComponent(token)}&email=${encodeURIComponent(normalized)}`;
  await transport(settings).sendMail({
    from: `"${settings.fromName.replace(/["\r\n]/g, "")}" <${settings.fromEmail}>`,
    to: normalized,
    subject: "Recuperación de acceso al panel",
    text: `Recibimos una solicitud para restablecer tu contraseña. Abre este enlace dentro de los próximos 30 minutos:\n\n${url}\n\nSi no la solicitaste, ignora este correo.`,
    html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p><p><a href="${url}">Restablecer contraseña</a></p><p>El enlace vence en 30 minutos. Si no la solicitaste, ignora este correo.</p>`,
  });
  return { accepted: true };
}

export async function resetPassword(email: string, token: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const user = await getDb().query.users.findFirst({ where: eq(users.email, normalized) });
  if (!user?.recoveryTokenHash || !user.recoveryTokenExpiresAt || user.recoveryTokenExpiresAt.getTime() < Date.now()) throw new Error("El enlace es inválido o ya venció. Solicita uno nuevo.");
  const supplied = Buffer.from(tokenHash(token));
  const expected = Buffer.from(user.recoveryTokenHash);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("El enlace es inválido o ya fue utilizado.");
  const passwordHash = await hashPassword(password);
  await getDb().update(users).set({ passwordHash, passwordChangedAt: new Date(), recoveryTokenHash: null, recoveryTokenExpiresAt: null }).where(eq(users.id, user.id));
  return { ok: true };
}

export async function sendTestEmail(settings: typeof emailSettings.$inferSelect, recipient: string) {
  await transport(settings).sendMail({ from: `"${settings.fromName.replace(/["\r\n]/g, "")}" <${settings.fromEmail}>`, to: recipient, subject: "Prueba de correo del panel", text: "La configuración SMTP del panel fue verificada correctamente." });
}
