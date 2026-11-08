import { addDays, guestPerson, rowsFor } from "./plan";
import type { Item, ListLine, Meal, Member, PantryRow, PlanDay, PlanGuest, PlanSlot } from "./types";
import { SLOTS } from "./types";

/** Items that are never bought by quantity — just checked at home. */
export const CHECK_ONLY = new Set(["garlic & spices"]);

export const AISLE_ORDER = [
  "Fruit & veg", "Meat & fish", "Dairy & eggs", "Bread & bakery", "Frozen", "Tins, jars & dry",
  "Spices & condiments", "Snacks & confectionery", "Desserts", "Drinks", "Household", "Toiletries & health", "Other",
];

/** Guests eat the meals planned for everyone on the days they're staying. */
export function guestsOn(guests: PlanGuest[], day: string): PlanGuest[] {
  return guests.filter((g) => g.from_day <= day && day <= g.to_day);
}

/** Total amount of each item the plan's meals need in one week, for everyone (and any guests), at their portion sizes. */
export function weekNeeds(
  planStart: string,
  week: number,
  days: PlanDay[],
  slots: PlanSlot[],
  members: Member[],
  mealMap: Map<string, Meal>,
  guests: PlanGuest[] = [],
): Map<string, number> {
  const need = new Map<string, number>();
  const start = addDays(planStart, week * 7);
  const addMeal = (mealId: string | null, people: number) => {
    const meal = mealId ? mealMap.get(mealId) : undefined;
    if (!meal) return;
    const share = people / (meal.servings || 1);
    for (const c of meal.meal_components ?? []) need.set(c.item_id, (need.get(c.item_id) ?? 0) + c.amount * share);
  };
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const dayType = days.find((d) => d.day === day)?.day_type ?? "home";
    const rows = slots.filter((s) => s.day === day);
    for (const member of members) {
      for (const slot of SLOTS) {
        for (const row of rowsFor(member, slot, dayType, rows)) addMeal(row.meal_id, member.portion_factor * row.portions);
      }
    }
    // guests: their own meal where a slot is "different per person", otherwise the meal for everyone
    for (const g of guestsOn(guests, day)) {
      const p = guestPerson(g);
      for (const slot of SLOTS) {
        for (const row of rowsFor(p, slot, dayType, rows)) addMeal(row.meal_id, g.people * Number(g.portion_factor) * row.portions);
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

export interface PastedLine {
  text: string;
  qty: number;
  category?: string;
  frequency?: "weekly" | "fortnightly" | "as_needed";
}

const UNIT_WORDS = /^(g|kg|ml|l|ltr|litres?|pints?|pack|packs|pk|x|cl|oz|lb)\b/i;

/** One pasted line → name + quantity. Understands "2 x milk", "2x milk", "milk x2", "milk (2)", "3 bananas". */
function splitQty(raw: string): { text: string; qty: number } {
  let s = raw.replace(/^\s*(?:[-•*·▪◦]|\d+[.)\]])\s+/, "").replace(/^\[\s?[xX ]?\s?\]\s*/, "").replace(/\s+/g, " ").trim();
  let qty = 1;
  let m = s.match(/^(\d{1,2})\s*[x×]\s*(.+)$/i);
  if (m) return { text: m[2].trim(), qty: Number(m[1]) };
  m = s.match(/^(.+?)\s*[x×]\s*(\d{1,2})$/i) || s.match(/^(.+?)\s*\((\d{1,2})\)$/);
  if (m) return { text: m[1].trim(), qty: Number(m[2]) };
  m = s.match(/^(\d{1,2})\s+(.+)$/);
  if (m && !UNIT_WORDS.test(m[2])) { qty = Number(m[1]); s = m[2]; }
  return { text: s.trim(), qty: Math.max(1, qty) };
}

const FREQ_WORDS: Record<string, PastedLine["frequency"]> = {
  weekly: "weekly", "every week": "weekly", week: "weekly",
  fortnightly: "fortnightly", "every 2 weeks": "fortnightly", "2 weeks": "fortnightly",
  "as needed": "as_needed", as_needed: "as_needed", occasionally: "as_needed", sometimes: "as_needed",
};

/**
 * Turn pasted text or a .txt/.csv file into items.
 * - one item per line (a single line with commas is split on the commas)
 * - CSV: name, then optional aisle and how-often columns; a header row is skipped
 * - duplicates are merged and their quantities added up
 */
export function parseLines(text: string, opts: { csv?: boolean; aisles?: string[] } = {}): PastedLine[] {
  let rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (!opts.csv && rows.length === 1 && /[,;]/.test(rows[0])) rows = rows[0].split(/[,;]/).map((r) => r.trim()).filter(Boolean);
  const aisleMap = new Map((opts.aisles ?? []).map((a) => [a.toLowerCase(), a]));
  const out = new Map<string, PastedLine>();
  rows.forEach((row, i) => {
    let cells = [row];
    if (opts.csv) cells = row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").trim());
    if (opts.csv && i === 0 && /^(name|item|items|product)$/i.test(cells[0])) return;
    const { text, qty } = splitQty(cells[0]);
    if (text.length < 2 || /^shopping( list)?:?$/i.test(text)) return;
    const line: PastedLine = { text, qty };
    if (cells[1]) line.category = aisleMap.get(cells[1].toLowerCase());
    if (cells[2]) line.frequency = FREQ_WORDS[cells[2].toLowerCase()];
    const key = text.toLowerCase();
    const prev = out.get(key);
    if (prev) prev.qty += qty;
    else out.set(key, line);
  });
  return [...out.values()];
}

/** Kept for older callers: names only. */
export function parsePasted(text: string): string[] {
  return parseLines(text).map((l) => l.text);
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
  ["Fruit & veg", ["apple", "banana", "orange", "grape", "lettuce", "tomato", "potato", "onion", "carrot", "pepper", "mushroom", "broccoli", "salad", "berr", "lemon", "lime", "avocado", "cucumber", "garlic", "ginger", "melon", "pear", "spinach", "strawberr", "blackberr", "raspberr", "blueberr", "cherr", "celery", "leek", "kale", "salad"]],
  ["Meat & fish", ["chicken", "beef", "pork", "lamb", "mince", "bacon", "sausage", "ham", "fish", "salmon", "cod", "tuna", "prawn", "steak", "turkey"]],
  ["Dairy & eggs", ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg"]],
  ["Bread & bakery", ["bread", "bread roll", "finger roll", "brioche", "bagel", "wrap", "crumpet", "muffin", "croissant", "loaf"]],
  ["Snacks & confectionery", ["crisp", "chocolate", "biscuit", "sweet", "cake", "popcorn", "nuts", "kettle", "tortilla chips", "pringles", "doritos", "cereal bar", "flapjack"]],
  ["Frozen", ["frozen", "ice cream", "chips", "peas", "fish fingers", "oven chips", "ice lolly"]],
  ["Drinks", ["coke", "cola", "juice", "water", "squash", "tea", "coffee", "beer", "wine", "lemonade", "pepsi", "gin", "tonic", "prosecco", "lager", "cider", "fanta", "sprite", "smoothie"]],
  ["Household", ["washing", "bleach", "loo roll", "toilet roll", "cleaner", "foil", "bin bag", "toilet", "kitchen roll", "sponge", "detergent", "dishwasher", "pods", "fabric conditioner", "softener", "cling", "batteries", "light bulb", "anti-bac", "wipes", "polish", "laundry"]],
  ["Toiletries & health", ["shampoo", "toothpaste", "soap", "deodorant", "razor", "plaster", "paracetamol", "ibuprofen", "shower gel", "conditioner", "mouthwash", "floss", "toothbrush", "moisturiser", "sun cream", "vitamin", "cotton", "hand wash", "lip balm", "tissues"]],
  ["Tins, jars & dry", ["tin", "pasta", "rice", "beans", "soup", "sauce", "flour", "sugar", "cereal", "oats", "stock", "granola", "muesli", "cornflakes", "weetabix", "lentil", "chickpea", "pulse", "noodle", "jam", "honey", "peanut butter", "marmite", "tuna", "passata", "couscous", "quinoa", "crackers"]],
  ["Spices & condiments", ["salt", "pepper", "spice", "ketchup", "mayo", "vinegar", "oil", "mustard", "herb", "cumin", "paprika", "turmeric", "oregano", "seasoning", "gravy", "chilli powder", "curry powder", "garam", "nutmeg", "bay leaves", "brown sauce", "soy"]],
];

/**
 * Suggest an aisle for a new item from the items you already have: the aisle of the existing items that
 * share the most words with it (the last word — usually what the thing is — counts double). Falls back to
 * keywords, then "Other".
 */
export function suggestCategory(name: string, items: Pick<Item, "name" | "category">[]): string {
  const q = norm(name).filter((w) => w.length >= 3 && !/^(pint|pack|tin|tinned|large|small|medium|fresh|frozen|organic|british)$/.test(w));
  if (q.length) {
    const head = q[q.length - 1];
    const score = new Map<string, number>();
    for (const it of items) {
      if (!it.category || it.category === "Other") continue;
      const t = norm(it.name.replace(/\(.*?\)/g, " "));
      const tset = new Set(t);
      const hits = q.filter((w) => tset.has(w)).length;
      if (!hits) continue;
      // what the thing is (last word) matching counts most; extra words in the existing name count against it
      const sameThing = t[t.length - 1] === head ? 3 : 0;
      const extra = t.filter((w) => !q.includes(w)).length;
      const sc = hits + sameThing - 0.3 * extra;
      if (sc < 2) continue;
      // add up the good matches, so an aisle with several similar items wins a tie
      score.set(it.category, (score.get(it.category) ?? 0) + sc);
    }
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return guessCategory(name);
}

export function guessCategory(name: string): string {
  const n = name.toLowerCase();
  for (const [cat, words] of CATEGORY_WORDS) if (words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n))) return cat;
  return "Other";
}

export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
