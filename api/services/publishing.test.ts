import { describe, expect, it } from "vitest";
import { networksAvailableForMedia, requiresPublicVideo } from "@contracts/publishing";
import { decryptSecret, encryptSecret } from "./secrets";
import { assertPublicHttpsUrl } from "./public-url";

describe("reglas de publicación programada", () => {
  it("exige video únicamente cuando el formato elegido es Reel", () => {
    expect(requiresPublicVideo("reel")).toBe(true);
    expect(requiresPublicVideo("image")).toBe(false);
    expect(requiresPublicVideo("story")).toBe(false);
  });

  it("omite TikTok y YouTube sin video y conserva las demás redes", () => {
    expect(networksAvailableForMedia(["instagram", "facebook", "tiktok", "youtube"], false)).toEqual(["instagram", "facebook"]);
    expect(networksAvailableForMedia(["tiktok", "youtube"], false)).toEqual([]);
    expect(networksAvailableForMedia(["instagram", "tiktok", "youtube"], true)).toEqual(["instagram", "tiktok", "youtube"]);
  });

  it("cifra secretos sin guardar el texto original y permite descifrarlos en el servidor", () => {
    const encrypted = encryptSecret("https://hook.example.com/secret");
    expect(encrypted).not.toContain("hook.example.com");
    expect(decryptSecret(encrypted)).toBe("https://hook.example.com/secret");
  });

  it("rechaza URLs inseguras o de red privada", () => {
    expect(() => assertPublicHttpsUrl("http://example.com/video.mp4")).toThrow();
    expect(() => assertPublicHttpsUrl("https://localhost/hook")).toThrow();
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/hook")).toThrow();
    expect(assertPublicHttpsUrl("https://cdn.example.com/video.mp4").hostname).toBe("cdn.example.com");
  });
});
