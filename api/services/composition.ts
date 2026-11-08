import type sharp from "sharp";
import { MOREKA_BRAND } from "@contracts/content-plan";
import type { GridStroke } from "@contracts/grid-cycle";
import { alignedStrokes, compositionBrand, type CompositionOrganization } from "./stroke-svg";

type SharpEngine = typeof sharp;
const sharpPackage = "sharp";
let sharpPromise: Promise<SharpEngine> | undefined;

async function sharpEngine(): Promise<SharpEngine> {
  sharpPromise ??= import(/* @vite-ignore */ sharpPackage).then((module) => module.default as SharpEngine);
  return sharpPromise;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const logoPromises = new Map<string, Promise<Buffer>>();
const DEFAULT_STROKE: GridStroke = { color: MOREKA_BRAND.primary, level: 1, ordinal: 1, position: 1 };

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);
}

function wrap(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else line = candidate;
  }
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const remaining = words.slice(consumed).join(" ");
  if (remaining) lines.push(remaining.length > maxCharacters * 1.4 ? `${remaining.slice(0, maxCharacters * 1.35).trim()}…` : remaining);
  return lines.slice(0, maxLines);
}

function multiline(value: string, x: number, y: number, maxCharacters: number, maxLines: number, lineHeight: number, style: string): string {
  return `<text x="${x}" y="${y}" ${style}>${wrap(value, maxCharacters, maxLines).map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

async function officialLogo(url: string): Promise<Buffer> {
  if (!logoPromises.has(url)) {
    logoPromises.set(url, fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Official logo returned HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }));
  }
  return logoPromises.get(url)!;
}

export async function composeProductImage(input: {
  scene: Uint8Array;
  title: string;
  features: [string, string, string];
  stroke?: GridStroke;
  organization?: CompositionOrganization;
}): Promise<Buffer> {
  const sharp = await sharpEngine();
  if (input.features.length !== 3 || input.features.some((feature) => !feature.trim())) throw new Error("Exactly three product features are required");
  const brand = compositionBrand(input.organization);
  const stroke = input.stroke || DEFAULT_STROKE;
  const scene = await sharp(input.scene)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
    .modulate({ brightness: 1.02, saturation: 0.92 })
    .linear(1.035, -3)
    .jpeg({ quality: 94 })
    .toBuffer();
  const logo = await sharp(await officialLogo(brand.logoUrl)).resize(220, 66, { fit: "inside" }).png().toBuffer();
  const features = input.features.map((feature, index) => {
    const y = 1000 + index * 83;
    return `<circle cx="76" cy="${y - 10}" r="10" fill="${brand.primary}"/>
      <path d="M71 ${y - 10}l4 4 7-9" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${multiline(feature, 105, y, 43, 2, 34, 'font-family="Inter, sans-serif" font-size="29" font-weight="600" fill="#FFFFFF"')}`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="48%" stop-color="${brand.ink}" stop-opacity="0"/><stop offset="100%" stop-color="${brand.ink}" stop-opacity="0.94"/></linearGradient></defs>
    <rect width="1080" height="1350" fill="url(#shade)"/>
    ${alignedStrokes(stroke)}
    <rect x="42" y="38" width="286" height="102" rx="22" fill="#FFFFFF" fill-opacity="0.94"/>
    <rect x="38" y="205" width="760" height="145" rx="22" fill="#FFFFFF" fill-opacity="0.82"/>
    ${multiline(input.title, 56, 260, 34, 2, 58, `font-family="Inter, sans-serif" font-size="48" font-weight="700" fill="${brand.ink}"`)}
    <rect x="42" y="914" width="996" height="296" rx="28" fill="${brand.ink}" fill-opacity="0.80"/>
    <text x="66" y="961" font-family="Inter, sans-serif" font-size="20" font-weight="700" letter-spacing="2.5" fill="${brand.secondary}">TRES RAZONES PARA ELEGIRLO</text>
    ${features}
    <rect x="42" y="1240" width="996" height="68" rx="18" fill="${brand.primary}"/>
    <text x="540" y="1284" text-anchor="middle" font-family="Inter, sans-serif" font-size="25" font-weight="700" fill="#FFFFFF">DESCUBRE MÁS EN MOREKASHOP.COM</text>
  </svg>`);
  return sharp(scene).composite([{ input: overlay }, { input: logo, left: 75, top: 56 }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

export async function composeEditorialImage(input: {
  title: string;
  summary: string;
  optionA?: string | null;
  optionB?: string | null;
  stroke?: GridStroke;
  organization?: CompositionOrganization;
}): Promise<Buffer> {
  const sharp = await sharpEngine();
  const brand = compositionBrand(input.organization);
  const stroke = input.stroke || DEFAULT_STROKE;
  const logo = await sharp(await officialLogo(brand.logoUrl)).resize(230, 70, { fit: "inside" }).png().toBuffer();
  const logoData = `data:image/png;base64,${logo.toString("base64")}`;
  const options = input.optionA && input.optionB ? `
    <rect x="64" y="850" width="456" height="185" rx="30" fill="#FFFFFF" stroke="${brand.secondary}" stroke-width="3"/>
    <rect x="560" y="850" width="456" height="185" rx="30" fill="#FFFFFF" stroke="${brand.secondary}" stroke-width="3"/>
    <text x="100" y="905" font-family="Inter, sans-serif" font-size="22" font-weight="700" fill="${brand.primary}">OPCIÓN A</text>
    <text x="596" y="905" font-family="Inter, sans-serif" font-size="22" font-weight="700" fill="${brand.primary}">OPCIÓN B</text>
    ${multiline(input.optionA, 100, 970, 22, 2, 40, `font-family="Inter, sans-serif" font-size="32" font-weight="700" fill="${brand.ink}"`)}
    ${multiline(input.optionB, 596, 970, 22, 2, 40, `font-family="Inter, sans-serif" font-size="32" font-weight="700" fill="${brand.ink}"`)}` : "";
  const svg = Buffer.from(`<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1350" fill="#FFFFFF"/>
    <circle cx="1000" cy="120" r="390" fill="${brand.secondary}" fill-opacity="0.16"/>
    <circle cx="50" cy="1300" r="440" fill="${brand.primary}" fill-opacity="0.06"/>
    ${alignedStrokes(stroke, true)}
    <rect x="64" y="58" width="310" height="112" rx="24" fill="#FFFFFF"/>
    <image href="${logoData}" x="104" y="79" width="230" height="70"/>
    <rect x="64" y="250" width="116" height="9" rx="4" fill="${brand.primary}"/>
    ${multiline(input.title, 64, 355, 24, 4, 74, `font-family="Inter, sans-serif" font-size="62" font-weight="700" fill="${brand.ink}"`)}
    ${multiline(input.summary, 64, 670, 45, 5, 46, `font-family="Inter, sans-serif" font-size="34" font-weight="400" fill="${brand.ink}"`)}
    ${options}
    <rect x="64" y="1168" width="952" height="96" rx="24" fill="${brand.primary}"/>
    <text x="540" y="1228" text-anchor="middle" font-family="Inter, sans-serif" font-size="28" font-weight="700" fill="#FFFFFF">MOREKASHOP.COM</text>
  </svg>`);
  return sharp(svg).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
