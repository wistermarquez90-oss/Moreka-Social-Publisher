import { describe, expect, it } from "vitest";
import { hashPassword, passwordValidationError, verifyPassword } from "./password";
import { tokenHash } from "./recovery-token";

describe("acceso del propietario", () => {
  it("exige longitud, mayúscula, minúscula y número", () => {
    expect(passwordValidationError("Aa1xyz")).toContain("8");
    expect(passwordValidationError("minuscula1")).toContain("mayúscula");
    expect(passwordValidationError("MAYUSCULA1")).toContain("minúscula");
    expect(passwordValidationError("SinNumero")).toContain("número");
    expect(passwordValidationError("Clave123")).toBeNull();
  });

  it("guarda un hash con sal y verifica sin conservar el texto", async () => {
    const first = await hashPassword("Clave123");
    const second = await hashPassword("Clave123");
    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toContain("Clave123");
    expect(first).not.toBe(second);
    expect(await verifyPassword("Clave123", first)).toBe(true);
    expect(await verifyPassword("Clave124", first)).toBe(false);
  });

  it("almacena tokens de recuperación únicamente como huella SHA-256", () => {
    const hash = tokenHash("token-de-prueba-no-real");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("token-de-prueba-no-real");
    expect(tokenHash("token-de-prueba-no-real")).toBe(hash);
  });
});
