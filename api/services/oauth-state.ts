import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../lib/env";

export type OAuthState = { userId: number; organizationId: number; network: "instagram" | "facebook" | "tiktok" | "youtube"; nonce: string; expiresAt: number };
const STATE_TTL_MS = 10 * 60 * 1000;

function signature(payload: string) {
  return createHmac("sha256", `${env.appSecret}:moreka-social-oauth`).update(payload).digest("base64url");
}

export function createOAuthState(value: Omit<OAuthState, "nonce" | "expiresAt">) {
  const state: OAuthState = { ...value, nonce: randomBytes(16).toString("base64url"), expiresAt: Date.now() + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyOAuthState(value: string): OAuthState {
  const [payload, supplied, ...rest] = value.split(".");
  if (!payload || !supplied || rest.length) throw new Error("Estado OAuth inválido.");
  const expected = signature(payload);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("La firma de autorización no es válida.");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  if (!state.expiresAt || state.expiresAt < Date.now()) throw new Error("La autorización expiró; inicia la conexión otra vez.");
  return state;
}
