import { describe, expect, it } from "vitest";
import { ACTIVE_PUBLISHING_NETWORKS } from "@contracts/publishing";
import { createOAuthState, verifyOAuthState } from "./oauth-state";
import { oauthRedirectUri } from "./social-oauth";
import { socialOAuthRoutes } from "../routes/social-oauth";

describe("autorización social oficial", () => {
  it("firma y recupera el contexto de empresa sin incluir secretos", () => {
    const state = createOAuthState({ userId: 7, organizationId: 3, network: "tiktok" });
    expect(state).not.toContain("client_secret");
    expect(verifyOAuthState(state)).toMatchObject({ userId: 7, organizationId: 3, network: "tiktok" });
  });

  it("rechaza un estado OAuth manipulado", () => {
    const state = createOAuthState({ userId: 7, organizationId: 3, network: "youtube" });
    expect(() => verifyOAuthState(`${state.slice(0, -2)}xx`)).toThrow();
  });

  it("mantiene LinkedIn fuera de las nuevas programaciones", () => {
    expect(ACTIVE_PUBLISHING_NETWORKS).toEqual(["instagram", "facebook", "tiktok", "youtube"]);
    expect(ACTIVE_PUBLISHING_NETWORKS).not.toContain("linkedin");
  });

  it("usa el dominio público HTTPS detrás del proxy, no la dirección interna", () => {
    const request = new Request("http://app-interno.cn-beijing-vpc.fcapp.run/api/trpc/social.callbackUrl", {
      headers: { "x-forwarded-host": "moreka-preview.ejemplo.com", "x-forwarded-proto": "https" },
    });
    expect(oauthRedirectUri(request)).toBe("https://moreka-preview.ejemplo.com/api/social/oauth/callback");
  });

  it("fuerza HTTPS en el dominio público aunque el proxy informe HTTP", () => {
    const request = new Request("http://app-interno.cn-beijing-vpc.fcapp.run/api/trpc/social.callbackUrl", {
      headers: { "x-forwarded-host": "we4asq52lszue.kimi.pro", "x-forwarded-proto": "http" },
    });
    expect(oauthRedirectUri(request)).toBe("https://we4asq52lszue.kimi.pro/api/social/oauth/callback");
  });

  it("conserva el origen de la solicitud cuando no hay un proxy público", () => {
    const request = new Request("http://localhost:3000/api/trpc/social.callbackUrl");
    expect(oauthRedirectUri(request)).toBe("http://localhost:3000/api/social/oauth/callback");
  });

  it("muestra el error real del proveedor aunque no devuelva state", async () => {
    const response = await socialOAuthRoutes.request("/callback?error_code=1349187&error_message=Inicio+seguro+bloqueado");
    expect(response.status).toBe(302);
    const location = response.headers.get("location") || "";
    expect(location).toContain("/configuracion?oauth=error");
    expect(decodeURIComponent(location)).toContain("1349187");
    expect(decodeURIComponent(location)).toContain("Inicio seguro bloqueado");
  });
});
