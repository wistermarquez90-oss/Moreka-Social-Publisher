import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const scrypt = promisify(scryptCallback);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Nueva contraseña del propietario (mínimo 12 caracteres): ");
rl.close();
if (password.length < 12) throw new Error("Usa al menos 12 caracteres");
const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64);
console.log(`scrypt$${salt.toString("base64")}$${Buffer.from(hash).toString("base64")}`);
