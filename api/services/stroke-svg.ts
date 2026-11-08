import { monochromeColor, type GridStroke } from "@contracts/grid-cycle";
import { MOREKA_BRAND } from "@contracts/content-plan";

export type CompositionOrganization = {
  primaryColor: string;
  secondaryColor: string;
  inkColor: string;
  backgroundColor: string;
  logoUrl?: string | null;
} | null | undefined;

export function compositionBrand(organization: CompositionOrganization) {
  return {
    primary: organization?.primaryColor || MOREKA_BRAND.primary,
    secondary: organization?.secondaryColor || MOREKA_BRAND.secondary,
    ink: organization?.inkColor || MOREKA_BRAND.ink,
    background: organization?.backgroundColor || MOREKA_BRAND.background,
    logoUrl: organization?.logoUrl || MOREKA_BRAND.logoUrl,
  };
}

export function alignedStrokes(stroke: GridStroke, editorial = false): string {
  const color = monochromeColor(stroke.color, stroke.level);
  const width = [0, 20, 16, 12][stroke.level];
  const bend = stroke.position === 1 ? 32 : stroke.position === 2 ? -24 : 18;
  const top = editorial ? 202 : 170;
  return `
    <path d="M-20 ${top} C210 ${top - bend} 375 ${top + bend} 570 ${top} S900 ${top - bend} 1100 ${top}"
      fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
    <path d="M-20 ${top + 25} C250 ${top + 8} 430 ${top + 42} 660 ${top + 22} S930 ${top + 5} 1100 ${top + 24}"
      fill="none" stroke="${color}" stroke-opacity="0.34" stroke-width="5" stroke-linecap="round"/>
    <path d="M18 ${top + 48} V${top + 120} M1062 ${top + 48} V${top + 120}"
      fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
    <path d="M38 1318 H1042" fill="none" stroke="${color}" stroke-opacity="0.78" stroke-width="8" stroke-linecap="round"/>
  `;
}
