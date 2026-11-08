import { createHash } from "node:crypto";

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
