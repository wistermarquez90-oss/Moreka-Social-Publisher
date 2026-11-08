import { describe, expect, it } from "vitest";
import { buildContentPlan } from "./content-plan";
import { institutionalPalette, monochromeColor, requiredRowAccent, strokeForOrdinal } from "./grid-cycle";
import { addCalendarDays, calendarDateKey, nextUnoccupiedDate } from "./publishing-continuity";

const palette = ["#0FABE2", "#98CDEF", "#333E48"];

describe("trazos monocromáticos de la cuadrícula", () => {
  it("degrada tres posiciones y cambia al siguiente tono con la misma rutina", () => {
    const sequence = Array.from({ length: 7 }, (_, index) => strokeForOrdinal(index + 1, palette));
    expect(sequence.map((stroke) => stroke.color)).toEqual([
      palette[0], palette[0], palette[0], palette[1], palette[1], palette[1], palette[2],
    ]);
    expect(sequence.map((stroke) => stroke.level)).toEqual([1, 2, 3, 1, 2, 3, 1]);
    expect(monochromeColor(palette[0]!, 1)).toBe(palette[0]);
    expect(monochromeColor(palette[0]!, 2)).not.toBe(monochromeColor(palette[0]!, 3));
  });

  it("permite escoger el tono inicial sin salir de la paleta institucional", () => {
    expect(strokeForOrdinal(1, palette, palette[1]).color).toBe(palette[1]);
    expect(strokeForOrdinal(4, palette, palette[1]).color).toBe(palette[2]);
    expect(institutionalPalette({ primaryColor: "#0fabe2", secondaryColor: "#0FABE2", inkColor: "#333E48" })).toEqual(["#0FABE2", "#333E48"]);
  });

  it("usa el primer elemento de la fila como ancla, no el orden de consulta", () => {
    const items = [
      { gridPosition: 2, rowNumber: 1, accentColor: "#98CDEF" },
      { gridPosition: 1, rowNumber: 1, accentColor: "#0FABE2" },
      { gridPosition: 3, rowNumber: 1, accentColor: null },
    ];
    expect(requiredRowAccent(items, 1)).toBe("#0FABE2");
  });
});

describe("planes de creación configurables", () => {
  it("conserva 7+3 en diez y repite el ritmo editorial en lotes variables", () => {
    expect(buildContentPlan(false, 10).filter((slot) => slot.type === "product")).toHaveLength(7);
    expect(buildContentPlan(false, 3).map((slot) => slot.type)).toEqual(["product", "product", "editorial"]);
    expect(buildContentPlan(false, 13).filter((slot) => slot.type === "editorial").map((slot) => slot.position)).toEqual([3, 7, 10, 13]);
    expect(buildContentPlan(false, 1)).toHaveLength(1);
  });
});

describe("continuidad diaria", () => {
  it("calcula días en la zona de la empresa y permite varias publicaciones por fecha", () => {
    const date = new Date("2026-10-27T02:00:00.000Z");
    expect(calendarDateKey(date, "America/Mexico_City")).toBe("2026-10-26");
    expect(addCalendarDays("2026-10-26", 1)).toBe("2026-10-27");
    expect(nextUnoccupiedDate(["2026-10-26", "2026-10-27"], date, "America/Mexico_City")).toBe("2026-10-28");
  });
});
