import { addDays, rowsFor } from "./plan";
import type { Item, ListLine, Meal, Member, PantryRow, PlanDay, PlanSlot } from "./types";
import { SLOTS } from "./types";

/** Items that are never bought by quantity — just checked at home. */
export const CHECK_ONLY = new Set(["garlic & spices"]);

export const AISLE_ORDER = [
  "Fruit & veg", "Meat & fish", "Dairy & eggs", "Bread & bakery", "Frozen", "Tins, jars & dry",
  "Spices & condiments", "Snacks & confectionery", "Desserts", "Drinks", "Household", "Toiletries & health", "Other",
];

/** Total amount of each item the plan's meals need in one week, for everyone, at their portion sizes. */
export function weekNeeds(
  planStart: string,
  week: number,
  days: PlanDay[],
  slots: PlanSlot[],
  members: Member[],
  mealMap: Map<string, Meal>,
): Map<string, number> {
  const need = new Map<string, number>();
  const start = addDays(planStart, week * 7);
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const dayType = days.find((d) => d.day === day)?.day_type ?? "home";
    const rows = slots.filter((s) => s.day === day);
    for (const member of members) {
      for (const slot of SLOTS) {
        for (const row of rowsFor(member, slot, dayType, rows)) {
          const meal = row.meal_id ? mealMap.get(row.meal_id) : undefined;
          if (!meal) continue;
          const share = (member.portion_factor * row.portions) / (meal.servings || 1);
          for (const c of meal.meal_components ?? []) {
            need.set(c.item_id, (need.get(c.item_id) ?? 0) + c.amount * share);
          }
        }
      }
    }
  }
  return need;
}

/** Leftovers still in date at the start of the week, per item. */
export function pantryAvailable(pantry: PantryRow[], weekStart: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pantry) {
    if (p.use_by && p.use_by < weekStart) continue;
    out.set(p.item_id, (out.get(p.item_id) ?? 0) + Number(p.qty));
  }
  return out;
}

export interface PlannedLine {
  item_id: string;
  need: number;
  from_pantry: number;
  packs: number;
}

/** Meal lines: needs minus leftovers, rounded up to whole packs. */
export function mealLines(needs: Map<string, number>, available: Map<string, number>, items: Map<string, Item>): PlannedLine[] {
  const out: PlannedLine[] = [];
  for (const [item_id, rawNeed] of needs) {
    const item = items.get(item_id);
    if (!item || rawNeed <= 0) continue;
    const need = round2(rawNeed);
    const from_pantry = round2(Math.min(available.get(item_id) ?? 0, need));
    const remaining = need - from_pantry;
    let packs = 0;
    if (CHECK_ONLY.has(item.name)) packs = 0;
    else if (remaining > 0.0001) packs = item.pack_size ? Math.ceil(remaining / Number(item.pack_size) - 1e-9) : 1;
    out.push({ item_id, need, from_pantry, packs });
  }
  return out;
}

/** Store-cupboard regulars for a plan week (fortnightly items on weeks 1 and 3). */
export function regularsFor(items: Item[], week: number): Item[] {
  return items.filter((i) => i.is_cupboard && (i.buy_frequency === "weekly" || (i.buy_frequency === "fortnightly" && week % 2 === 0)));
}

/**
 * What happens to the leftovers record once a list is bought:
 * - leftovers the meals use are taken off,
 * - the spare from each part-used pack is added with a use-by date.
 */
export function afterPurchase(lines: ListLine[], items: Map<string, Item>, today: string) {
  const deduct = new Map<string, number>();
  const add: { item_id: string; qty: number; use_by: string | null }[] = [];
  for (const l of lines) {
    if (l.source !== "meal" || l.removed) continue;
    const item = items.get(l.item_id);
    if (!item) continue;
    if (l.from_pantry > 0) deduct.set(l.item_id, (deduct.get(l.item_id) ?? 0) + Number(l.from_pantry));
    if (l.have_it || !item.pack_size || l.packs <= 0) continue;
    const remaining = Number(l.need ?? 0) - Number(l.from_pantry);
    const spare = round2(l.packs * Number(item.pack_size) - remaining);
    if (spare > 0.0001) add.push({ item_id: l.item_id, qty: spare, use_by: item.keep_days ? addDays(today, item.keep_days) : null });
  }
  return { deduct, add };
}

/** Take quantities off pantry rows, soonest use-by first. Returns row updates and deletions. */
export function deductPantry(rows: PantryRow[], deduct: Map<string, number>) {
  const updates: { id: string; qty: number }[] = [];
  const deletes: string[] = [];
  const sorted = [...rows].sort((a, b) => (a.use_by ?? "9999") .localeCompare(b.use_by ?? "9999"));
  const left = new Map(deduct);
  for (const r of sorted) {
    const want = left.get(r.item_id) ?? 0;
    if (want <= 0) continue;
    const take = Math.min(want, Number(r.qty));
    left.set(r.item_id, want - take);
    const rest = round2(Number(r.qty) - take);
    if (rest <= 0.0001) deletes.push(r.id);
    else updates.push({ id: r.id, qty: rest });
  }
  return { updates, deletes };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function fmtAmount(item: Item, qty: number): string {
  if (item.unit === "each") {
    const n = Math.round(qty * 100) / 100;
    return `${n}`;
  }
  const g = Math.ceil(qty / 5) * 5;
  const u = item.unit;
  return g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2).replace(/0$/, "")} ${u === "g" ? "kg" : "L"}` : `${g} ${u}`;
}

export function fmtPack(item: Item): string {
  if (item.usual_pack) return item.usual_pack;
  if (!item.pack_size) return "";
  return item.unit === "each" ? `pack of ${Number(item.pack_size)}` : fmtAmount(item, Number(item.pack_size)) + " pack";
}

// ---------------------------------------------------------------------------
// Alexa import: turn pasted text into lines and match each to an item
// ---------------------------------------------------------------------------

export function parsePasted(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n|,|;/)
    .map((s) => s.replace(/^[\s\-•*·\d.)\]]+/, "").replace(/^x\s+/i, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 1 && !/^shopping( list)?$/i.test(s))
    .filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function norm(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["x", "of", "the", "a", "and", "some", "pack", "packs", "g", "kg", "ml"].includes(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 3 && w.endsWith("es") ? w.slice(0, -2) : w.length > 2 && w.endsWith("s") ? w.slice(0, -1) : w));
}

export function matchItem(text: string, items: Item[]): { item: Item; score: number } | null {
  const q = norm(text);
  if (!q.length) return null;
  const qs = q.join(" ");
  let best: { item: Item; score: number } | null = null;
  for (const item of items) {
    const names = [item.name, ...(item.aliases ?? [])];
    for (const n of names) {
      const t = norm(n);
      if (!t.length) continue;
      const ts = t.join(" ");
      let score: number;
      if (ts === qs) score = 1;
      else {
        const inter = q.filter((w) => t.includes(w)).length;
        score = inter / Math.max(q.length, t.length);
        if (inter === q.length) score = Math.max(score, 0.75); // every typed word is in the name
      }
      if (!best || score > best.score) best = { item, score };
    }
  }
  return best && best.score >= 0.6 ? best : null;
}

const CATEGORY_WORDS: [string, string[]][] = [
  ["Fruit & veg", ["apple", "banana", "orange", "grape", "lettuce", "tomato", "potato", "onion", "carrot", "pepper", "mushroom", "broccoli", "salad", "berr", "lemon", "lime", "avocado", "cucumber", "garlic", "ginger", "melon", "pear", "spinach"]],
  ["Meat & fish", ["chicken", "beef", "pork", "lamb", "mince", "bacon", "sausage", "ham", "fish", "salmon", "cod", "tuna", "prawn", "steak", "turkey"]],
  ["Dairy & eggs", ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg"]],
  ["Bread & bakery", ["bread", "roll", "bagel", "wrap", "crumpet", "muffin", "croissant", "loaf"]],
  ["Frozen", ["frozen", "ice cream", "chips", "peas"]],
  ["Drinks", ["coke", "cola", "juice", "water", "squash", "tea", "coffee", "beer", "wine", "lemonade", "pepsi"]],
  ["Snacks & confectionery", ["crisp", "chocolate", "biscuit", "sweet", "cake", "popcorn", "nuts"]],
  ["Household", ["washing", "bleach", "cleaner", "foil", "bin bag", "toilet", "kitchen roll", "sponge", "detergent", "dishwasher", "pods"]],
  ["Toiletries & health", ["shampoo", "toothpaste", "soap", "deodorant", "razor", "plaster", "paracetamol", "ibuprofen", "shower gel"]],
  ["Tins, jars & dry", ["tin", "pasta", "rice", "beans", "soup", "sauce", "flour", "sugar", "cereal", "oats", "stock"]],
  ["Spices & condiments", ["salt", "pepper", "spice", "ketchup", "mayo", "vinegar", "oil", "mustard", "herb"]],
];

export function guessCategory(name: string): string {
  const n = name.toLowerCase();
  for (const [cat, words] of CATEGORY_WORDS) if (words.some((w) => n.includes(w))) return cat;
  return "Other";
}

export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
