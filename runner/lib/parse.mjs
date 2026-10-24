// Pure helpers shared by the store readers: prices, pack sizes, offers and match scoring.
// No browser code here, so it can be tested anywhere.

export const STORES = ["tesco", "sainsburys", "morrisons", "ocado"];

export function money(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, "").match(/£\s*(\d+(?:\.\d{1,2})?)|(\d+)\s*p\b/i);
  if (!m) return null;
  return m[1] != null ? Number(m[1]) : Number(m[2]) / 100;
}

/** Read a pack size from a product name or size text. Returns { qty, unit: 'g'|'ml'|'each' } or null. */
export function parseSize(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/,/g, "");
  let m = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|litres?)\b/);
  if (m) return norm(Number(m[1]) * Number(m[2]), m[3]);
  m = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|litres?|ltr)\b/);
  if (m) return norm(Number(m[1]), m[2]);
  m = t.match(/(\d+)\s*pints?\b/);
  if (m) return { qty: Math.round(Number(m[1]) * 568), unit: "ml" };
  m = t.match(/(\d+)\s*(?:pack|pk|per pack|rolls?|eggs|pods|washes|bags)\b/) || t.match(/\bpack of (\d+)\b/) || t.match(/\b(\d+)\s*x\b/);
  if (m) return { qty: Number(m[1]), unit: "each" };
  if (/\b(each|loose|single)\b/.test(t)) return { qty: 1, unit: "each" };
  return null;
}

function norm(n, u) {
  if (u === "kg") return { qty: n * 1000, unit: "g" };
  if (u === "g") return { qty: n, unit: "g" };
  if (u === "l" || u.startsWith("litre") || u === "ltr") return { qty: n * 1000, unit: "ml" };
  if (u === "cl") return { qty: n * 10, unit: "ml" };
  return { qty: n, unit: "ml" };
}

/** Pack size in the item's own unit, if the units are compatible (g and ml treated alike). */
export function sizeInItemUnit(item, size) {
  if (!size) return null;
  if (item.unit === "each") return size.unit === "each" ? size.qty : null;
  if (size.unit === "each") return null;
  return size.qty;
}

/**
 * Cost of buying qty of a product, using the cheaper of the member price (Clubcard) and any multibuy.
 * Understands "3 for £5", "Any 2 for £6", "4 for 3", "Buy 1 get 1 free", "Half price".
 */
export function lineCost(qty, price, memberPrice, offerText) {
  if (price == null && memberPrice == null) return null;
  const unit = memberPrice ?? price;
  let best = unit * qty;
  const o = (offerText || "").toLowerCase();
  let m = o.match(/(\d+)\s*for\s*£\s*(\d+(?:\.\d{1,2})?)/);
  if (m && price != null) {
    const n = Number(m[1]), total = Number(m[2]);
    const cost = Math.floor(qty / n) * total + (qty % n) * unit;
    best = Math.min(best, cost);
  }
  m = o.match(/(\d+)\s*for\s*(?!£)(\d+)(?![\d.p])/);
  if (m && price != null) {
    const n = Number(m[1]), pay = Number(m[2]);
    if (n > pay) best = Math.min(best, (qty - Math.floor(qty / n) * (n - pay)) * price);
  }
  if (/buy\s*1\s*get\s*1\s*free|bogof/.test(o) && price != null) best = Math.min(best, Math.ceil(qty / 2) * price);
  return Math.round(best * 100) / 100;
}

// ---------------------------------------------------------------------------
// Matching a list item to a store's search results
// ---------------------------------------------------------------------------

const STOP = new Set(["and", "with", "the", "of", "in", "e", "g", "eg", "raw", "tin", "tins", "fresh", "frozen", "full", "fat", "per", "pack", "x"]);

export function words(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9% ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+(g|kg|ml|l)?$/.test(w))
    .map((w) => (w === "yoghurt" ? "yogurt" : w === "colas" ? "cola" : w))
    .map((w) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -1) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/** The search phrase for an item: brand (if locked) + name without brackets. */
export function searchQuery(item) {
  let name = String(item.name).replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  if (item.name === "Greek yogurt (full-fat, e.g. Fage 5%)") name = "greek yogurt";
  if (item.brand_lock && !name.toLowerCase().includes(item.brand_lock.toLowerCase())) name = `${item.brand_lock} ${name}`;
  return name;
}

const OWN_BRANDS = ["tesco", "sainsbury", "sainsburys", "morrison", "morrisons", "ocado", "m&s", "finest", "taste", "difference", "best", "british", "everyday", "essential", "stockwell", "savers", "organic"];

export function coverage(item, productName) {
  const want = words(String(item.name).replace(/\(.*?\)/g, " "));
  if (!want.length) return 0;
  const have = new Set(words(productName));
  return want.filter((w) => have.has(w)).length / want.length;
}

/**
 * Pick the best candidate: brand-locked products first, then the closest name match,
 * then the cheapest per gram/ml/unit (or cheapest overall when sizes can't be read).
 */
export function chooseBest(item, candidates) {
  const usable = candidates.filter((c) => c.price != null || c.memberPrice != null);
  if (!usable.length) return null;
  let pool = usable;
  if (item.brand_lock) {
    const b = item.brand_lock.toLowerCase();
    const branded = pool.filter((c) => c.name.toLowerCase().includes(b));
    if (branded.length) pool = branded;
  }
  const scored = pool.map((c) => ({ c, cov: coverage(item, c.name) }));
  const top = Math.max(...scored.map((s) => s.cov));
  if (top < 0.5) return null;
  let close = scored.filter((s) => s.cov >= top - 0.01).map((s) => s.c);
  // Avoid flavoured or fancy variants: keep the candidates with the fewest words beyond the item's own name.
  const own = new Set([...words(item.name), ...words(item.brand_lock || ""), ...OWN_BRANDS]);
  const extra = (c) => words(c.name).filter((w) => !own.has(w) && !/\d/.test(w)).length;
  const minExtra = Math.min(...close.map(extra));
  close = close.filter((c) => extra(c) <= minExtra + 2);
  // Store-cupboard items: stick to the usual pack size (e.g. 8 × 330 ml) when it can be read.
  const usual = parseSize(item.usual_pack);
  if (item.is_cupboard && usual) {
    const same = close.filter((c) => { const s = parseSize(`${c.name} ${c.size ?? ""}`); return s && s.unit === usual.unit && Math.abs(s.qty - usual.qty) <= usual.qty * 0.15; });
    if (same.length) close = same;
  }
  const withUnit = close.map((c) => {
    const size = sizeInItemUnit(item, parseSize(`${c.name} ${c.size ?? ""}`));
    const p = c.memberPrice ?? c.price;
    return { c, size, ppu: size ? p / size : null };
  });
  const sized = withUnit.filter((x) => x.ppu != null);
  // Prefer packs not wildly bigger than needed (≤ 3× the usual pack) when sizes are known.
  const target = Number(item.pack_size) || null;
  const sensible = target ? sized.filter((x) => x.size <= target * 3 && x.size >= target / 4) : sized;
  const pick = (sensible.length ? sensible : sized).sort((a, b) => a.ppu - b.ppu)[0]
    ?? withUnit.sort((a, b) => (a.c.memberPrice ?? a.c.price) - (b.c.memberPrice ?? b.c.price))[0];
  return { ...pick.c, sizeQty: pick.size ?? null };
}

/** How many of a store's packs to buy for a list line. */
export function qtyFor(line, item, sizeQty) {
  if (line.source === "meal" && sizeQty && line.need != null) {
    const remaining = Number(line.need) - Number(line.from_pantry || 0);
    if (remaining <= 0) return 0;
    return Math.max(1, Math.ceil(remaining / sizeQty - 1e-9));
  }
  return Math.max(0, Number(line.packs) || 0);
}

export function samePath(a, b) {
  const p = (u) => { try { return new URL(u, "https://x").pathname.replace(/\/$/, ""); } catch { return String(u); } };
  return a && b && p(a) === p(b);
}
