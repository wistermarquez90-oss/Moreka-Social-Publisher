export const STROKE_SEQUENCE_LENGTH = 3;

export type GridStroke = {
  color: string;
  level: 1 | 2 | 3;
  ordinal: number;
  position: number;
};

export function normalizeHex(color: string): string {
  return color.trim().toUpperCase();
}

export function institutionalPalette(input: {
  primaryColor: string;
  secondaryColor: string;
  inkColor: string;
}): string[] {
  return [...new Set([input.primaryColor, input.secondaryColor, input.inkColor]
    .map(normalizeHex)
    .filter((color) => /^#[0-9A-F]{6}$/.test(color)))];
}

export function monochromeColor(color: string, level: number): string {
  const hex = normalizeHex(color).slice(1);
  if (!/^[0-9A-F]{6}$/.test(hex)) return "#0FABE2";
  const amount = [0, 0, 0.24, 0.48][Math.max(0, Math.min(3, Math.round(level)))] ?? 0;
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function strokeForOrdinal(
  ordinal: number,
  palette: string[],
  startingColor?: string,
): GridStroke {
  const safeOrdinal = Math.max(1, Math.round(ordinal));
  const colors = palette.length ? palette.map(normalizeHex) : ["#0FABE2"];
  const requested = startingColor ? normalizeHex(startingColor) : colors[0];
  const startIndex = Math.max(0, colors.indexOf(requested));
  const sequence = Math.floor((safeOrdinal - 1) / STROKE_SEQUENCE_LENGTH);
  const color = colors[(startIndex + sequence) % colors.length]!;
  const level = (((safeOrdinal - 1) % STROKE_SEQUENCE_LENGTH) + 1) as 1 | 2 | 3;
  return { color, level, ordinal: safeOrdinal, position: ((safeOrdinal - 1) % 3) + 1 };
}

export function requiredRowAccent<T extends {
  rowNumber: number;
  gridPosition: number;
  accentColor?: string | null;
  backgroundColor?: string | null;
}>(items: T[], rowNumber: number, fallback = "#0FABE2"): string {
  const row = items
    .filter((item) => item.rowNumber === rowNumber)
    .sort((a, b) => a.gridPosition - b.gridPosition);
  return row.find((item) => item.accentColor)?.accentColor || fallback;
}
