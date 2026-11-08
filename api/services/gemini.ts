import { GoogleGenAI } from "@google/genai";
import { MOREKA_BRAND } from "@contracts/content-plan";

export async function generateOneProductScene(input: {
  title: string;
  productType?: string | null;
  description?: string | null;
  imageUrl: string;
  rowTheme: string;
}): Promise<{ bytes: Uint8Array; mimeType: string; interactionId: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required to generate a scene");
  const source = await fetch(input.imageUrl);
  if (!source.ok) throw new Error(`Product image returned HTTP ${source.status}`);
  const sourceBytes = Buffer.from(await source.arrayBuffer());
  if (sourceBytes.length > 20 * 1024 * 1024) throw new Error("Product image exceeds 20 MB");
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Create one photorealistic lifestyle product photograph, 4:5 portrait. Preserve the exact product shape, colors, ports, labels and details from the reference image. Show the product naturally in use by an adult, with the product as the clear hero. Product: ${input.title}. Category: ${input.productType || "accessory"}. Verified product description: ${(input.description || "").slice(0, 1800)}. Visual story for this row: ${input.rowTheme}. Use a quiet, softly tinted background derived only from Moreka's corporate palette: cyan ${MOREKA_BRAND.primary}, pale blue ${MOREKA_BRAND.secondary}, graphite ${MOREKA_BRAND.ink}, and very light neutral backgrounds. Soft diffused daylight, restrained contrast, coherent color grading, premium but realistic ecommerce photography. Leave calm negative space at the top and bottom for later layout. Absolutely no text, letters, numbers, logos, watermarks, prices, badges, packaging copy, promotional claims or graphic overlays in the generated scene.`;
  const interaction = await ai.interactions.create({
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image",
    input: [
      { type: "text", text: prompt },
      { type: "image", data: sourceBytes.toString("base64"), mime_type: source.headers.get("content-type")?.split(";")[0] || "image/jpeg" },
    ],
    response_modalities: ["IMAGE"],
    generation_config: { image_config: { aspect_ratio: "4:5", image_size: "1K" } },
    store: false,
  });
  if (!interaction.output_image?.data) {
    throw new Error(`Gemini returned no image (interaction ${interaction.id}, status ${interaction.status})`);
  }
  return {
    bytes: Buffer.from(interaction.output_image.data, "base64"),
    mimeType: interaction.output_image.mime_type || "image/png",
    interactionId: interaction.id,
  };
}
