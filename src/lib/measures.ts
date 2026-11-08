import type { Item, Unit } from "./types";

/**
 * How an item is measured. Each measure maps onto the item's base unit (g, ml or each) with a factor,
 * so amounts can be added up, compared with store pack sizes and rounded to whole packs.
 */
export interface Measure {
  id: string;
  one: string;      // "pint"
  many: string;     // "pints"
  base: Unit;       // g | ml | each
  factor: number;   // base units per 1 of this measure (pint = 568 ml)
  step: number;     // − / + step on the list
}

export const MEASURES: Measure[] = [
  { id: "pack", one: "pack", many: "packs", base: "each", factor: 1, step: 1 },
  { id: "each", one: "", many: "", base: "each", factor: 1, step: 1 },
  { id: "pint", one: "pint", many: "pints", base: "ml", factor: 568, step: 1 },
  { id: "litre", one: "litre", many: "litres", base: "ml", factor: 1000, step: 0.5 },
  { id: "ml", one: "ml", many: "ml", base: "ml", factor: 1, step: 100 },
  { id: "kg", one: "kg", many: "kg", base: "g", factor: 1000, step: 0.5 },
  { id: "g", one: "g", many: "g", base: "g", factor: 1, step: 50 },
  { id: "bottle", one: "bottle", many: "bottles", base: "each", factor: 1, step: 1 },
  { id: "can", one: "can", many: "cans", base: "each", factor: 1, step: 1 },
  { id: "tin", one: "tin", many: "tins", base: "each", factor: 1, step: 1 },
  { id: "jar", one: "jar", many: "jars", base: "each", factor: 1, step: 1 },
  { id: "bag", one: "bag", many: "bags", base: "each", factor: 1, step: 1 },
  { id: "box", one: "box", many: "boxes", base: "each", factor: 1, step: 1 },
  { id: "loaf", one: "loaf", many: "loaves", base: "each", factor: 1, step: 1 },
  { id: "roll", one: "roll", many: "rolls", base: "each", factor: 1, step: 1 },
  { id: "bunch", one: "bunch", many: "bunches", base: "each", factor: 1, step: 1 },
  { id: "punnet", one: "punnet", many: "punnets", base: "each", factor: 1, step: 1 },
  { id: "tub", one: "tub", many: "tubs", base: "each", factor: 1, step: 1 },
];

const BY_ID = new Map(MEASURES.map((m) => [m.id, m]));
const DEFAULT_FOR_UNIT: Record<Unit, string> = { g: "g", ml: "ml", each: "each" };

export function measureOf(item: Pick<Item, "unit" | "measure">): Measure {
  return BY_ID.get(item.measure ?? "") ?? BY_ID.get(DEFAULT_FOR_UNIT[item.unit])!;
}

/** Measures an item can switch to. Items used in meals keep their base unit (recipes are written in it). */
export function measuresFor(unit: Unit, usedInMeals: boolean): Measure[] {
  return usedInMeals ? MEASURES.filter((m) => m.base === unit) : MEASURES;
}

export function fmtMeasure(amount: number, m: Measure): string {
  const n = Math.round(amount * 100) / 100;
  if (!m.one) return `${n}`;
  if (m.id === "ml" || m.id === "g" || m.id === "kg") return `${n} ${m.one}`;
  return `${n} ${n === 1 ? m.one : m.many}`;
}

/** Amount (in the item's own measure) for a list line. */
export function lineAmount(item: Item, line: { need: number | null; packs: number }): number {
  const m = measureOf(item);
  const base = line.need != null ? Number(line.need) : line.packs * (Number(item.pack_size) || m.factor);
  return base / m.factor;
}

/** Packs needed to cover an amount (in base units). */
export function packsFor(item: Item, need: number): number {
  const size = Number(item.pack_size) || measureOf(item).factor;
  return Math.max(need > 0 ? 1 : 0, Math.ceil(need / size - 1e-9));
}

/**
 * What a new list line for this item should be: the usual amount you buy, or `packs` packs if given
 * (e.g. "2 x milk" pasted = 2 packs). Returns need (base units) and packs.
 */
export function defaultLine(item: Item, packs?: number): { need: number; packs: number } {
  const m = measureOf(item);
  const size = Number(item.pack_size) || m.factor;
  if (packs && packs > 0) return { need: packs * size, packs };
  const usual = Number(item.usual_qty) || 0;
  const need = usual > 0 ? usual * m.factor : size;
  return { need, packs: packsFor(item, need) };
}
