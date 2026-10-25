import { STORES, chooseBest, lineCost, parseSize, qtyFor, samePath, searchQuery, sizeInItemUnit } from "./parse.mjs";
import { STORE_INFO, search as liveSearch } from "./stores.mjs";

// tests can swap in a fake search
let search = liveSearch;
export function _setSearch(fn) { search = fn; }

const CHECK_ONLY = new Set(["garlic & spices"]);

/** First line of an error only (browser errors include a long log). */
const short = (e) => String(e?.message ?? e).split("\n")[0].replace(/\u001b\[[0-9;]*m/g, "").slice(0, 160);

/** The lines that actually need buying, with their items. */
export async function loadList(db, listId) {
  const { data: lines, error } = await db.from("list_lines").select("*").eq("list_id", listId);
  if (error) throw new Error(error.message);
  const ids = [...new Set(lines.map((l) => l.item_id))];
  const { data: items } = await db.from("items").select("*").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));
  const buy = lines.filter((l) => {
    const it = itemMap.get(l.item_id);
    return it && !l.removed && !l.have_it && l.packs > 0 && !CHECK_ONLY.has(it.name);
  });
  return { lines: buy, itemMap };
}

async function storeProducts(db, itemIds) {
  if (!itemIds.length) return new Map();
  const { data } = await db.from("store_products").select("*").in("item_id", itemIds);
  return new Map((data ?? []).map((r) => [`${r.item_id}:${r.store}`, r]));
}

function candidateSummary(c) {
  return { name: c.name, url: c.url, price: c.price, memberPrice: c.memberPrice, offer: c.offer, size: c.size, inStock: c.inStock };
}

/** Search one item at one store and save the best guess (never overwrites a match you approved). */
async function matchOne(db, page, store, item, existing, cache) {
  const query = searchQuery(item);
  const key = `${store}:${query.toLowerCase()}`;
  const results = cache.get(key) ?? (await search(page, store, query));
  cache.set(key, results);
  const best = chooseBest(item, results);
  const row = {
    item_id: item.id, store,
    candidates: results.slice(0, 12).map(candidateSummary),
    checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!existing || existing.status === "suggested") {
    Object.assign(row, {
      status: "suggested",
      product_name: best?.name ?? null,
      url: best?.url ?? null,
      size_text: best?.size ?? null,
      size_qty: best ? sizeInItemUnit(item, parseSize(`${best.name} ${best.size ?? ""}`)) : null,
      last_price: best ? best.memberPrice ?? best.price : null,
    });
  }
  const { data, error } = await db.from("store_products").upsert(row, { onConflict: "item_id,store" }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

function makeProgress(db, jobId, stores, total) {
  const done = Object.fromEntries(stores.map((s) => [s, 0]));
  let last = 0;
  return async (store, force = false) => {
    if (store) done[store]++;
    const now = Date.now();
    if (!force && now - last < 4000) return;
    last = now;
    const text = stores.map((s) => `${STORE_INFO[s].name} ${done[s]}/${total}`).join(" · ");
    await db.from("runner_jobs").update({ progress: text }).eq("id", jobId);
  };
}

/** Find products for every item on a list (or the given items) at each store. */
export async function runMatch(db, pages, job) {
  const stores = job.payload.stores ?? STORES;
  let items;
  if (job.payload.item_ids?.length) {
    const { data } = await db.from("items").select("*").in("id", job.payload.item_ids);
    items = data ?? [];
  } else {
    const { lines, itemMap } = await loadList(db, job.payload.list_id);
    items = [...new Set(lines.map((l) => l.item_id))].map((id) => itemMap.get(id));
  }
  const existing = await storeProducts(db, items.map((i) => i.id));
  const progress = makeProgress(db, job.id, stores, items.length);
  const errors = [];
  // One store at a time, in one tab, so the laptop isn't overloaded.
  for (const store of stores) {
    const cache = new Map();
    const page = await pages.open(store);
    for (const item of items) {
      const ex = existing.get(`${item.id}:${store}`);
      if (ex && !job.payload.refresh && ex.candidates?.length) { await progress(store); continue; }
      try {
        await matchOne(db, page, store, item, ex, cache);
      } catch (e) {
        errors.push(`${STORE_INFO[store].name}: ${short(e)}`);
        if (e.blocked) break;
      }
      await progress(store);
    }
    await pages.close(store);
  }
  await progress(null, true);
  return { items: items.length, errors: [...new Set(errors)].slice(0, 10) };
}

/** Price the whole list at each store, work out each basket total and save the comparison. */
export async function runPrice(db, pages, job) {
  const stores = job.payload.stores ?? STORES;
  const { lines, itemMap } = await loadList(db, job.payload.list_id);
  const { data: settings } = await db.from("settings").select("*").eq("id", 1).single();
  const sp = await storeProducts(db, lines.map((l) => l.item_id));
  const progress = makeProgress(db, job.id, stores, lines.length);
  const out = [];
  const errors = [];

  for (const store of stores) {
    const cache = new Map();
    let blocked = false;
    const page = await pages.open(store);
    for (const line of lines) {
      const item = itemMap.get(line.item_id);
      let match = sp.get(`${item.id}:${store}`);
      const rec = { store, item_id: item.id, qty: 0, in_stock: false, product_name: null, url: null, unit_price: null, member_price: null, offer_text: null, line_total: null };
      try {
        if (blocked) throw new Error("skipped");
        if (!match) match = await matchOne(db, page, store, item, null, cache);
        if (match.status !== "none" && match.product_name) {
          const query = match.product_name;
          const key = `${store}:${query.toLowerCase()}`;
          const results = cache.get(key) ?? (await search(page, store, query));
          cache.set(key, results);
          const found = results.find((r) => samePath(r.url, match.url)) ?? results.find((r) => r.name === match.product_name);
          if (found && (found.price != null || found.memberPrice != null)) {
            const sizeQty = match.size_qty ? Number(match.size_qty) : sizeInItemUnit(item, parseSize(`${found.name} ${found.size ?? match.size_text ?? ""}`));
            const qty = qtyFor(line, item, sizeQty);
            Object.assign(rec, {
              qty, in_stock: found.inStock, product_name: found.name, url: found.url,
              unit_price: found.price, member_price: store === "tesco" ? found.memberPrice : null, offer_text: found.offer,
              line_total: lineCost(qty, found.price ?? found.memberPrice, store === "tesco" ? found.memberPrice : null, found.offer),
            });
            await db.from("store_products").update({ last_price: found.memberPrice ?? found.price, checked_at: new Date().toISOString() }).eq("id", match.id);
          }
        }
      } catch (e) {
        if (e.message !== "skipped") errors.push(`${STORE_INFO[store].name}: ${short(e)}`);
        if (e.blocked) blocked = true;
      }
      out.push(rec);
      await progress(store);
    }
    await pages.close(store);
  }
  await progress(null, true);

  // Totals. Items a store doesn't have are estimated at the average of the other stores,
  // so a store isn't made to look cheaper just because things are missing.
  const priced = (r) => r.line_total != null && r.in_stock;
  const avg = new Map();
  for (const line of lines) {
    const vals = out.filter((r) => r.item_id === line.item_id && priced(r)).map((r) => r.line_total);
    avg.set(line.item_id, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  const totals = {};
  for (const store of stores) {
    const rows = out.filter((r) => r.store === store);
    const items = rows.filter(priced).reduce((a, r) => a + Number(r.line_total), 0);
    const missingRows = rows.filter((r) => !priced(r));
    const estimate = missingRows.reduce((a, r) => a + (avg.get(r.item_id) ?? 0), 0);
    const delivery = Number(settings?.delivery?.[store] ?? 0);
    const minSpend = Number(settings?.min_spend?.[store] ?? 0);
    const r2 = (n) => Math.round(n * 100) / 100;
    totals[store] = {
      items: r2(items), delivery, total: r2(items + delivery), missing: missingRows.length,
      compare: r2(items + delivery + estimate), estimate: r2(estimate), lines: rows.length,
      under_min: items < minSpend, min_spend: minSpend,
    };
  }
  const ranked = stores.filter((s) => totals[s].lines - totals[s].missing > 0).sort((a, b) => totals[a].compare - totals[b].compare);
  const cheapest = ranked[0] ?? null;

  const { data: check, error } = await db.from("price_checks")
    .insert({ list_id: job.payload.list_id, job_id: job.id, totals, cheapest }).select().single();
  if (error) throw new Error(error.message);
  for (let i = 0; i < out.length; i += 200) {
    const { error: e2 } = await db.from("price_lines").insert(out.slice(i, i + 200).map((r) => ({ ...r, check_id: check.id })));
    if (e2) throw new Error(e2.message);
  }
  return { check_id: check.id, cheapest, totals, errors: [...new Set(errors)].slice(0, 10) };
}

/**
 * Fill one store's trolley with the list, using the latest price check (product + quantity per line).
 * Never checks out. Saves the markup of anything it couldn't handle to runner/debug for fixing.
 */
export async function runFill(db, pages, job, { addToTrolley, saveDebug }) {
  const store = job.payload.store;
  if (!store) throw new Error("No store chosen");
  const { data: checks } = await db.from("price_checks").select("*").eq("list_id", job.payload.list_id).order("created_at", { ascending: false }).limit(1);
  const check = checks?.[0];
  if (!check) throw new Error("Run a price check first");
  const { data: plines } = await db.from("price_lines").select("*").eq("check_id", check.id).eq("store", store);
  const { lines, itemMap } = await loadList(db, job.payload.list_id);
  const wanted = new Set(lines.map((l) => l.item_id));
  const todo = (plines ?? []).filter((p) => wanted.has(p.item_id) && p.url && p.qty > 0);
  const skipped = (plines ?? []).filter((p) => wanted.has(p.item_id) && (!p.url || p.qty <= 0)).map((p) => itemMap.get(p.item_id)?.name);
  const page = await pages.open(store);
  const results = [];
  let done = 0;
  for (const p of todo) {
    const name = itemMap.get(p.item_id)?.name ?? p.product_name;
    let r;
    try {
      r = await addToTrolley(page, store, p.product_name, p.url, p.qty);
    } catch (e) {
      r = { got: 0, status: "failed", note: short(e) };
    }
    if (r.html) await saveDebug(`${store}-${p.item_id}`, r.html);
    results.push({ item: name, product: p.product_name, want: p.qty, got: r.got, status: r.status, note: r.note ?? null });
    done++;
    await db.from("runner_jobs").update({ progress: `${STORE_INFO[store].name}: ${done}/${todo.length} added` }).eq("id", job.id);
    if (r.status === "signin") break;
  }
  await pages.close(store);
  const problems = results.filter((r) => r.status !== "added");
  return {
    store, added: results.length - problems.length, total: todo.length, problems,
    not_priced: skipped.filter(Boolean),
    errors: problems.some((p) => p.status === "signin") ? [`${STORE_INFO[store].name} asked you to sign in — run "npm run setup" on the laptop, sign in, then try again.`] : [],
  };
}
