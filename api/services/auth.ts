import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { eq } from "drizzle-orm";
import { users, type User } from "@db/schema";
import { getDb } from "../queries/connection";
import { findUserByUnionId } from "../queries/users";
import { env } from "../lib/env";
import { signSessionToken, verifySessionToken } from "../kimi/session";
import { verifyPassword } from "./password";

export { hashPassword, passwordValidationError } from "./password";

export async function authenticateExternal(headers: Headers): Promise<User | undefined> {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) return undefined;
  const payload = await verifySessionToken(token);
  if (!payload || payload.clientId !== "external") return undefined;
  const user = await findUserByUnionId(payload.unionId);
  if (!user || user.role !== "admin" || user.accessStatus !== "active") return undefined;
  if (user.passwordChangedAt && (!payload.iat || user.passwordChangedAt.getTime() > payload.iat * 1000 + 1000)) return undefined;
  return user;
}

export async function loginExternal(email: string, password: string): Promise<{ user: User; token: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  let user = await getDb().query.users.findFirst({ where: eq(users.email, normalizedEmail) });
  if (user?.passwordHash) {
    if (user.role !== "admin" || user.accessStatus !== "active" || !(await verifyPassword(password, user.passwordHash))) throw new Error("Credenciales inválidas");
    await getDb().update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
    return { user, token: await signSessionToken({ unionId: user.unionId, clientId: "external" }) };
  }

  // Respaldo para una instalación Docker nueva antes de configurar el acceso desde el panel.
  if (env.authDriver !== "password" || normalizedEmail !== env.ownerEmail.trim().toLowerCase()) throw new Error("Credenciales inválidas");
  if (!(await verifyPassword(password, env.ownerPasswordHash))) throw new Error("Credenciales inválidas");
  const unionId = `external:${normalizedEmail}`;
  user = await findUserByUnionId(unionId);
  if (!user) {
    const [{ id }] = await getDb().insert(users).values({ unionId, email: normalizedEmail, name: "Propietario Moreka Shop", role: "admin", accessStatus: "active", passwordHash: env.ownerPasswordHash, passwordChangedAt: new Date(), lastSignInAt: new Date() }).$returningId();
    user = await getDb().query.users.findFirst({ where: eq(users.id, id) });
  } else {
    await getDb().update(users).set({ role: "admin", accessStatus: "active", passwordHash: env.ownerPasswordHash, passwordChangedAt: new Date(), lastSignInAt: new Date() }).where(eq(users.id, user.id));
    user = { ...user, role: "admin", accessStatus: "active", lastSignInAt: new Date() };
  }
  if (!user) throw new Error("No se pudo iniciar la sesión");
  return { user, token: await signSessionToken({ unionId, clientId: "external" }) };
}
