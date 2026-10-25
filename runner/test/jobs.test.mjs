// Dry run of a price check with a stand-in database and canned search results.
import { runMatch, runPrice, _setSearch } from "../lib/jobs.mjs";

const tables = {
  items: [
    { id: "i1", name: "Greek yogurt (full-fat, e.g. Fage 5%)", unit: "g", pack_size: 1000, brand_lock: null, is_cupboard: false },
    { id: "i2", name: "Coca-Cola Zero Sugar", unit: "each", pack_size: 1, brand_lock: "Coca-Cola", is_cupboard: true, usual_pack: "8 × 330 ml cans" },
  ],
  list_lines: [
    { id: "l1", list_id: "L", item_id: "i1", source: "meal", need: 1800, from_pantry: 0, packs: 2, have_it: false, removed: false },
    { id: "l2", list_id: "L", item_id: "i2", source: "regular", need: null, from_pantry: 0, packs: 1, have_it: false, removed: false },
  ],
  settings: [{ id: 1, delivery: { tesco: 0, sainsburys: 4.5, morrisons: 5.5, ocado: 4.99 }, min_spend: { tesco: 50, sainsburys: 40, morrisons: 40, ocado: 40 } }],
  store_products: [], runner_jobs: [{ id: "J" }], price_checks: [], price_lines: [],
};
let n = 0;
function q(t) {
  let rows = tables[t], filt = [], op = "select", payload = null, conflict = null;
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k, v) { filt.push((r) => r[k] === v); return api; },
    in(k, v) { filt.push((r) => v.includes(r[k])); return api; },
    insert(p) { op = "insert"; payload = p; return api; },
    upsert(p, o) { op = "upsert"; payload = p; conflict = o?.onConflict?.split(","); return api; },
    update(p) { op = "update"; payload = p; return api; },
    single() { return api.then((r) => ({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error })); },
    then(res, rej) {
      let data;
      if (op === "select") data = rows.filter((r) => filt.every((f) => f(r)));
      else if (op === "insert") { const arr = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `${t}${++n}`, ...p })); rows.push(...arr); data = arr; }
      else if (op === "upsert") { const arr = Array.isArray(payload) ? payload : [payload]; data = arr.map((p) => { const ex = rows.find((r) => conflict.every((c) => r[c] === p[c])); if (ex) return Object.assign(ex, p); const nr = { id: `${t}${++n}`, ...p }; rows.push(nr); return nr; }); }
      else { data = rows.filter((r) => filt.every((f) => f(r))); data.forEach((r) => Object.assign(r, payload)); }
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return api;
}
const db = { from: q };
const stubPages = { open: async () => null, close: async () => {} };
const canned = {
  tesco: [{ name: "Tesco Greek Style Yogurt 500G", url: "https://www.tesco.com/shop/en-GB/products/258170229", price: 1.15, memberPrice: null, offer: null, inStock: true },
          { name: "Coca-Cola Zero Sugar 8 x 330ml", url: "https://www.tesco.com/shop/en-GB/products/1", price: 5.25, memberPrice: 4.5, offer: null, inStock: true }],
  sainsburys: [{ name: "Sainsbury's Greek Style Natural Yogurt 1kg", url: "https://www.sainsburys.co.uk/groceries/product/sgy-1kg", price: 2.1, inStock: true },
               { name: "Coca-Cola Zero Sugar 8x330ml", url: "https://www.sainsburys.co.uk/groceries/product/coke-8", price: 5.5, inStock: true }],
  morrisons: [{ name: "Morrisons Greek Style Yogurt", size: "1kg", url: "https://groceries.morrisons.com/products/x/1", price: 1.7, offer: "2 for £3", inStock: true }],
  ocado: [{ name: "Ocado Greek Style Natural Yogurt", size: "1kg", url: "https://www.ocado.com/products/y/2", price: 2.2, inStock: true },
          { name: "Coca-Cola Zero Sugar", size: "8 x 330ml", url: "https://www.ocado.com/products/c/3", price: 5.0, offer: "Buy any 2 for £9", inStock: true }],
};
_setSearch(async (page, store, query) => canned[store].filter((c) => query.toLowerCase().split(" ").some((w) => c.name.toLowerCase().includes(w))));
const m = await runMatch(db, stubPages, { id: "J", payload: { list_id: "L" } });
console.log("match", m);
console.log(tables.store_products.map((s) => `${s.store} ${s.item_id} → ${s.product_name} (size ${s.size_qty})`).join("\n"));
const r = await runPrice(db, stubPages, { id: "J", payload: { list_id: "L" } });
console.log("cheapest", r.cheapest);
for (const [s, t] of Object.entries(r.totals)) console.log(s.padEnd(11), JSON.stringify(t));
console.log(tables.price_lines.map((l) => `${l.store} ${l.item_id} qty ${l.qty} £${l.line_total}`).join("\n"));

// basket fill with a fake trolley
const { runFill } = await import("../lib/jobs.mjs");
const debug = [];
const fill = await runFill(db, stubPages, { id: "J", payload: { list_id: "L", store: "tesco" } }, {
  addToTrolley: async (page, store, name, url, qty) => (name.includes("Coca") ? { got: 1, status: "partial", note: "Couldn't find the + button", html: "<div>card</div>" } : { got: qty, status: "added" }),
  saveDebug: async (n, h) => debug.push(n),
});
console.log("fill", JSON.stringify(fill), "debug", debug);
