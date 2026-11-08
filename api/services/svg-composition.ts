import { MOREKA_BRAND } from "@contracts/content-plan";
import type { GridStroke } from "@contracts/grid-cycle";
import { alignedStrokes, compositionBrand, type CompositionOrganization } from "./stroke-svg";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);
}

function lines(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/);
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > maxCharacters && current && output.length < maxLines - 1) {
      output.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current && output.length < maxLines) output.push(current);
  return output;
}

function text(value: string, x: number, y: number, maxCharacters: number, maxLines: number, lineHeight: number, style: string): string {
  return `<text x="${x}" y="${y}" ${style}>${lines(value, maxCharacters, maxLines).map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

export async function composeProductSvg(input: {
  scene: Uint8Array;
  sceneMimeType: string;
  title: string;
  features: [string, string, string];
  stroke?: GridStroke;
  organization?: CompositionOrganization;
}): Promise<Uint8Array> {
  const brand = compositionBrand(input.organization);
  const stroke = input.stroke || { color: MOREKA_BRAND.primary, level: 1, ordinal: 1, position: 1 } satisfies GridStroke;
  const logoResponse = await fetch(brand.logoUrl);
  if (!logoResponse.ok) throw new Error(`Official logo returned HTTP ${logoResponse.status}`);
  const logo = Buffer.from(await logoResponse.arrayBuffer()).toString("base64");
  const scene = Buffer.from(input.scene).toString("base64");
  const features = input.features.map((feature, index) => {
    const y = 1000 + index * 83;
    return `<circle cx="76" cy="${y - 10}" r="10" fill="${brand.primary}"/><path d="M71 ${y - 10}l4 4 7-9" fill="none" stroke="white" stroke-width="3"/>${text(feature, 105, y, 43, 2, 34, 'font-family="Inter, sans-serif" font-size="29" font-weight="600" fill="#FFFFFF"')}`;
  }).join("");
  const svg = `<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="48%" stop-color="${brand.ink}" stop-opacity="0"/><stop offset="100%" stop-color="${brand.ink}" stop-opacity="0.94"/></linearGradient><filter id="preset"><feColorMatrix type="saturate" values="0.92"/><feComponentTransfer><feFuncR type="linear" slope="1.035" intercept="0.005"/><feFuncG type="linear" slope="1.035" intercept="0.005"/><feFuncB type="linear" slope="1.035" intercept="0.005"/></feComponentTransfer></filter></defs>
    <image href="data:${input.sceneMimeType};base64,${scene}" width="1080" height="1350" preserveAspectRatio="xMidYMid slice" filter="url(#preset)"/>
    <rect width="1080" height="1350" fill="url(#shade)"/>
    ${alignedStrokes(stroke)}
    <rect x="42" y="38" width="286" height="102" rx="22" fill="#FFFFFF" fill-opacity="0.94"/>
    <rect x="38" y="205" width="760" height="145" rx="22" fill="#FFFFFF" fill-opacity="0.82"/>
    <image href="data:image/png;base64,${logo}" x="75" y="56" width="220" height="66" preserveAspectRatio="xMidYMid meet"/>
    ${text(input.title, 56, 260, 34, 2, 58, `font-family="Inter, sans-serif" font-size="48" font-weight="700" fill="${brand.ink}"`)}
    <rect x="42" y="914" width="996" height="296" rx="28" fill="${brand.ink}" fill-opacity="0.80"/>
    <text x="66" y="961" font-family="Inter, sans-serif" font-size="20" font-weight="700" letter-spacing="2.5" fill="${brand.secondary}">TRES RAZONES PARA ELEGIRLO</text>
    ${features}
    <rect x="42" y="1240" width="996" height="68" rx="18" fill="${brand.primary}"/>
    <text x="540" y="1284" text-anchor="middle" font-family="Inter, sans-serif" font-size="25" font-weight="700" fill="#FFFFFF">DESCUBRE MÁS EN MOREKASHOP.COM</text>
  </svg>`;
  return new TextEncoder().encode(svg);
}
