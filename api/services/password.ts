import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function passwordValidationError(password: string) {
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Z]/.test(password)) return "La contraseña debe incluir al menos una mayúscula.";
  if (!/[a-z]/.test(password)) return "La contraseña debe incluir al menos una minúscula.";
  if (!/[0-9]/.test(password)) return "La contraseña debe incluir al menos un número.";
  return null;
}

export async function hashPassword(password: string) {
  const error = passwordValidationError(password);
  if (error) throw new Error(error);
  const salt = randomBytes(16).toString("base64");
  const hash = Buffer.from(await scrypt(password, Buffer.from(salt, "base64"), 64) as Buffer).toString("base64");
  return `scrypt$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltValue, expectedValue, ...rest] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !expectedValue || rest.length) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, "base64"), 64) as Buffer);
  const expected = Buffer.from(expectedValue, "base64");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
