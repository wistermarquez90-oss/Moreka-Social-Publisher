import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composeEditorialImage, composeProductImage } from "./composition";

describe("composición de marca", () => {
  it("compone una escena con exactamente tres características a 1080 × 1350", async () => {
    const scene = await sharp({ create: { width: 900, height: 1100, channels: 3, background: "#98CDEF" } }).jpeg().toBuffer();
    const image = await composeProductImage({ scene, title: "Producto Moreka de prueba", features: ["Primera característica", "Segunda característica", "Tercera característica"] });
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
    expect(metadata.format).toBe("jpeg");
  }, 30000);

  it("crea una pieza editorial sin una escena de producto", async () => {
    const image = await composeEditorialImage({ title: "¿Cuál va más con tu estilo?", summary: "Dos formas de equipar tu día.", optionA: "Solo lo esencial", optionB: "Preparado para todo" });
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  }, 30000);
});
