import { describe, expect, it } from "vitest";
import { buildContentPlan, editorialCopy, monthKeyFor } from "@contracts/content-plan";

describe("plan editorial 7 + 3", () => {
  it("intercala tres editoriales y siete productos en posiciones estables", () => {
    const plan = buildContentPlan(false);
    expect(plan).toHaveLength(10);
    expect(plan.filter((slot) => slot.type === "product")).toHaveLength(7);
    expect(plan.filter((slot) => slot.type === "editorial").map((slot) => slot.position)).toEqual([3, 7, 10]);
    expect(plan[9].editorialKind).toBe("educational");
    expect(plan.map((slot) => slot.row)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
    expect(new Set(plan.map((slot) => slot.preset)).size).toBe(1);
  });

  it("usa la posición diez para el sorteo solo con premios confirmados", () => {
    expect(buildContentPlan(true)[9].editorialKind).toBe("giveaway");
    expect(() => editorialCopy({ kind: "giveaway" })).toThrow(/requiere premio principal/);
    const copy = editorialCopy({ kind: "giveaway", primaryPrize: "Premio A", taggedFriendPrize: "Premio B" });
    expect(copy.body).toContain("Premio A");
    expect(copy.body).toContain("Premio B");
  });

  it("genera una clave mensual UTC válida", () => {
    expect(monthKeyFor(new Date("2026-01-04T23:00:00Z"))).toBe("2026-01");
  });
});
