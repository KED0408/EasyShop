"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AlexaImport from "@/components/AlexaImport";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { addDays, fmtDate, weekday } from "@/lib/plan";
import {
  afterPurchase, AISLE_ORDER, CHECK_ONLY, deductPantry, fmtAmount, fmtPack, guessCategory, mealLines,
  pantryAvailable, regularsFor, tidyName, weekNeeds,
} from "@/lib/shopping";
import type { Item, ListLine, PantryRow, Plan, PlanDay, PlanSlot, ShoppingList } from "@/lib/types";

const SOURCE_LABEL: Record<ListLine["source"], string> = { meal: "meals", regular: "regular", alexa: "Alexa", added: "added" };
const CACHE = "easyshop-list-cache";

function pickDefault(plans: Plan[]): { planId: string; week: number } | null {
  if (!plans.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  // You order on Wednesday or Thursday, so from Wednesday onwards the list opens on the following week.
  const target = weekday(today) >= 2 ? addDays(today, 7 - weekday(today)) : today;
  for (const p of plans) {
    for (let w = 0; w < p.weeks; w++) {
      const start = addDays(p.start_date, w * 7);
      if (addDays(start, 7) > target) return { planId: p.id, week: w };
    }
  }
  return { planId: plans[plans.length - 1].id, week: plans[plans.length - 1].weeks - 1 };
}

export default function ListPage() {
  const { members, items, itemMap, mealMap, loading, reload: reloadHousehold } = useHousehold();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [sel, setSel] = useState<{ planId: string; week: number } | null>(null);
  const [list, setList] = useState<ShoppingList | null>(null);
  const [lines, setLines] = useState<ListLine[]>([]);
  const [mode, setMode] = useState<"check" | "shop">("check");
  const [panel, setPanel] = useState<"none" | "alexa">("none");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    supabase().from("plans").select("*").order("start_date").then(({ data, error }) => {
      if (error) {
        setOffline(true);
        try {
          const c = JSON.parse(localStorage.getItem(CACHE) || "null");
          if (c) { setList(c.list); setLines(c.lines); setMode("shop"); }
        } catch {}
      }
      const ps = (data as Plan[]) ?? [];
      setPlans(ps);
      setSel(pickDefault(ps));
    });
  }, []);

  const plan = plans?.find((p) => p.id === sel?.planId) ?? null;

  /** Load (or create) the list for the chosen week and bring its meal lines up to date with the plan. */
  const build = useCallback(async () => {
    if (!plan || !sel || loading) return;
    setBusy("Updating from the plan…");
    setError(null);
    const db = supabase();
    let { data: l } = await db.from("shopping_lists").select("*").eq("plan_id", plan.id).eq("week", sel.week).maybeSingle();
    if (!l) {
      const ins = await db.from("shopping_lists").insert({ plan_id: plan.id, week: sel.week }).select().single();
      if (ins.error) { setBusy(null); return setError(ins.error.message); }
      l = ins.data;
    }
    const sl = l as ShoppingList;
    const [d, s, p, ln] = await Promise.all([
      db.from("plan_days").select("*").eq("plan_id", plan.id),
      db.from("plan_slots").select("*").eq("plan_id", plan.id),
      db.from("pantry_stock").select("*"),
      db.from("list_lines").select("*").eq("list_id", sl.id),
    ]);
    let current = (ln.data as ListLine[]) ?? [];

    if (sl.status === "open") {
      const needs = weekNeeds(plan.start_date, sel.week, (d.data as PlanDay[]) ?? [], (s.data as PlanSlot[]) ?? [], members, mealMap);
      const planned = mealLines(needs, pantryAvailable((p.data as PantryRow[]) ?? [], addDays(plan.start_date, sel.week * 7)), itemMap);
      const existingMeal = new Map(current.filter((x) => x.source === "meal").map((x) => [x.item_id, x]));
      const upserts = planned.map((pl) => {
        const ex = existingMeal.get(pl.item_id);
        return {
          list_id: sl.id, item_id: pl.item_id, source: "meal" as const, need: pl.need, from_pantry: pl.from_pantry,
          // keep a pack count someone changed by hand, unless the meals now need more
          packs: ex && ex.packs > pl.packs ? ex.packs : pl.packs,
          have_it: ex?.have_it ?? false, ticked: ex?.ticked ?? false, removed: ex?.removed ?? false,
        };
      });
      const stale = current.filter((x) => x.source === "meal" && !planned.some((pl) => pl.item_id === x.item_id)).map((x) => x.id);
      const regs = regularsFor(items, sel.week)
        .filter((it) => !current.some((x) => x.item_id === it.id && x.source === "regular"))
        .map((it) => ({ list_id: sl.id, item_id: it.id, source: "regular" as const, packs: 1 }));
      const ops = [];
      if (upserts.length) ops.push(db.from("list_lines").upsert(upserts, { onConflict: "list_id,item_id,source" }));
      if (stale.length) ops.push(db.from("list_lines").delete().in("id", stale));
      if (regs.length) ops.push(db.from("list_lines").insert(regs));
      const res = await Promise.all(ops);
      const err = res.find((r) => r.error)?.error;
      if (err) setError(err.message);
      const again = await db.from("list_lines").select("*").eq("list_id", sl.id);
      current = (again.data as ListLine[]) ?? [];
    }
    setList(sl);
    setLines(current);
    setBusy(null);
  }, [plan, sel, loading, members, mealMap, itemMap, items]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!offline) build();
  }, [build, offline]);

  useEffect(() => {
    if (list) try { localStorage.setItem(CACHE, JSON.stringify({ list, lines })); } catch {}
  }, [list, lines]);

  function patch(line: ListLine, p: Partial<ListLine>) {
    setLines(lines.map((x) => (x.id === line.id ? { ...x, ...p } : x)));
    supabase().from("list_lines").update(p).eq("id", line.id).then(({ error }) => error && setError(error.message));
  }

  async function addItem() {
    const name = adding.trim();
    if (!name || !list) return;
    const db = supabase();
    let item: Item | undefined = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (!item) {
      const ins = await db.from("items").insert({
        name: tidyName(name), category: guessCategory(name), unit: "each", is_cupboard: true, buy_frequency: "as_needed", pack_size: 1,
      }).select().single();
      if (ins.error) return setError(ins.error.message);
      item = ins.data as Item;
      await reloadHousehold();
      setMessage(`${item.name} saved to the store cupboard.`);
    }
    const { error } = await db.from("list_lines").upsert(
      { list_id: list.id, item_id: item.id, source: "added", packs: 1, removed: false },
      { onConflict: "list_id,item_id,source" },
    );
    if (error) return setError(error.message);
    setAdding("");
    build();
  }

  async function markBought() {
    if (!list || !window.confirm("Mark this week as bought? Leftovers from part-used packs will be saved for the following weeks.")) return;
    setBusy("Saving…");
    const db = supabase();
    const today = new Date().toISOString().slice(0, 10);
    const { data: pantry } = await db.from("pantry_stock").select("*");
    const { deduct, add } = afterPurchase(lines, itemMap, today);
    const { updates, deletes } = deductPantry((pantry as PantryRow[]) ?? [], deduct);
    const ops = [
      ...updates.map((u) => db.from("pantry_stock").update({ qty: u.qty }).eq("id", u.id)),
      ...(deletes.length ? [db.from("pantry_stock").delete().in("id", deletes)] : []),
      ...(add.length ? [db.from("pantry_stock").insert(add.map((a) => ({ ...a, source: "leftover" })))] : []),
      db.from("shopping_lists").update({ status: "bought", bought_at: new Date().toISOString() }).eq("id", list.id),
    ];
    const res = await Promise.all(ops);
    const err = res.find((r) => r.error)?.error;
    setBusy(null);
    if (err) return setError(err.message);
    setMessage(`Done. ${add.length} leftover${add.length === 1 ? "" : "s"} saved to the fridge record.`);
    build();
  }

  async function reopen() {
    if (!list) return;
    await supabase().from("shopping_lists").update({ status: "open", bought_at: null }).eq("id", list.id);
    setMessage("List reopened. Leftovers already saved stay in the fridge record — adjust them there if needed.");
    build();
  }

  const visible = lines.filter((l) => !l.removed);
  const groups = useMemo(() => {
    const g = new Map<string, ListLine[]>();
    for (const l of visible) {
      const it = itemMap.get(l.item_id);
      const cat = it?.category ?? "Other";
      if (!g.has(cat)) g.set(cat, []);
      g.get(cat)!.push(l);
    }
    for (const arr of g.values()) arr.sort((a, b) => (itemMap.get(a.item_id)?.name ?? "").localeCompare(itemMap.get(b.item_id)?.name ?? ""));
    const rank = (c: string) => { const i = AISLE_ORDER.indexOf(c); return i < 0 ? 99 : i; };
    return [...g.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [visible, itemMap]);

  const toBuy = visible.filter((l) => !l.have_it && l.packs > 0 && !CHECK_ONLY.has(itemMap.get(l.item_id)?.name ?? ""));
  const ticked = toBuy.filter((l) => l.ticked).length;
  const removed = lines.filter((l) => l.removed);

  if (plans && plans.length === 0) {
    return <main className="page"><h1>Shopping list</h1><p>Create a meal plan first. <Link href="/plans">Go to plans</Link></p></main>;
  }

  return (
    <main className="page">
      <h1>Shopping list</h1>
      {offline && <p className="notice">You&apos;re offline — showing the last list saved on this phone. Ticks will not sync until you&apos;re back online.</p>}

      {plans && plan && sel && (
        <section className="card tight">
          <select aria-label="Plan" value={plan.id} onChange={(e) => setSel({ planId: e.target.value, week: 0 })}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="weektabs">
            {Array.from({ length: plan.weeks }, (_, w) => (
              <button key={w} className="chip" aria-pressed={sel.week === w} onClick={() => setSel({ planId: plan.id, week: w })}>
                Week {w + 1} · {fmtDate(addDays(plan.start_date, w * 7))}
              </button>
            ))}
          </div>
        </section>
      )}

      {list && (
        <section className="card tight">
          <div className="row between">
            <span><b className="num">{toBuy.length}</b> to buy{list.status === "bought" ? " · bought" : ""}{mode === "shop" ? ` · ${ticked} ticked` : ""}</span>
            <div className="chips">
              <button className="chip" aria-pressed={mode === "check"} onClick={() => setMode("check")}>Check at home</button>
              <button className="chip" aria-pressed={mode === "shop"} onClick={() => setMode("shop")}>Tick off</button>
            </div>
          </div>
          {mode === "check" && list.status === "open" && (
            <p className="muted small" style={{ margin: 0 }}>Tick <b>Have it</b> for anything already in, and adjust packs. Leftovers from earlier weeks are already taken off.</p>
          )}
          {list.status === "open" && (
            <div className="row">
              <input type="text" list="all-items" placeholder="Add anything else…" value={adding} onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} aria-label="Add an item" className="grow" style={{ width: "auto" }} />
              <datalist id="all-items">{items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
              <button className="btn sm" onClick={addItem}>Add</button>
              <button className="btn sm" onClick={() => setPanel(panel === "alexa" ? "none" : "alexa")}>Import Alexa list</button>
              <Link className="btn sm" href="/cupboard">Store cupboard</Link>
            </div>
          )}
        </section>
      )}

      {panel === "alexa" && list && (
        <AlexaImport items={items} listId={list.id} onClose={() => setPanel("none")}
          onDone={(n) => { setPanel("none"); setMessage(`${n} item${n === 1 ? "" : "s"} added from Alexa. Now clear the Alexa shopping list so nothing is added twice.`); reloadHousehold(); build(); }} />
      )}

      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error small">{error}</p>}
      {busy && <p className="muted small">{busy}</p>}

      {groups.map(([cat, ls]) => (
        <section key={cat} className="card tight">
          <h3>{cat}</h3>
          <ul className="list">
            {ls.map((l) => {
              const it = itemMap.get(l.item_id);
              if (!it) return null;
              const checkOnly = CHECK_ONLY.has(it.name);
              const covered = l.source === "meal" && l.packs === 0 && !checkOnly;
              const faded = l.have_it || covered || checkOnly;
              return (
                <li key={l.id} style={{ opacity: faded && mode === "shop" ? 0.45 : 1 }}>
                  <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                    {mode === "shop" && !faded && (
                      <input type="checkbox" checked={l.ticked} aria-label={`Got ${it.name}`} style={{ width: 26, height: 26, marginTop: 2 }}
                        onChange={(e) => patch(l, { ticked: e.target.checked })} />
                    )}
                    <div className="grow">
                      <b style={{ textDecoration: l.ticked && mode === "shop" ? "line-through" : "none" }}>{it.name}</b>
                      {it.brand_lock && <span className="tag" style={{ marginLeft: 6 }}>{it.brand_lock} only</span>}
                      <div className="muted small">
                        {checkOnly ? "Check you have enough" :
                          l.source === "meal" ? (
                            <>Meals need {fmtAmount(it, Number(l.need ?? 0))}
                              {l.from_pantry > 0 && <> · {fmtAmount(it, Number(l.from_pantry))} from leftovers</>}
                              {covered ? " · covered by leftovers" : it.pack_size ? ` · ${fmtPack(it)}` : ""}</>
                          ) : (<>{fmtPack(it) || "1 pack"} · {SOURCE_LABEL[l.source]}</>)}
                      </div>
                    </div>
                    {!checkOnly && !covered && (
                      <div className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                        {mode === "check" && list?.status === "open" && (
                          <button className="btn ghost sm" aria-label={`One fewer ${it.name}`} onClick={() => patch(l, { packs: Math.max(1, l.packs - 1) })}>−</button>
                        )}
                        <span className="num" style={{ minWidth: 28, textAlign: "center" }}>× {l.packs}</span>
                        {mode === "check" && list?.status === "open" && (
                          <button className="btn ghost sm" aria-label={`One more ${it.name}`} onClick={() => patch(l, { packs: l.packs + 1 })}>+</button>
                        )}
                      </div>
                    )}
                  </div>
                  {mode === "check" && list?.status === "open" && !checkOnly && !covered && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="chip" aria-pressed={l.have_it} onClick={() => patch(l, { have_it: !l.have_it })}>Have it</button>
                      <button className="btn ghost sm" onClick={() => patch(l, { removed: true })}>Remove</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {removed.length > 0 && mode === "check" && (
        <details className="card tight">
          <summary className="small">Removed ({removed.length})</summary>
          <ul className="list">
            {removed.map((l) => (
              <li key={l.id} className="row between">
                <span>{itemMap.get(l.item_id)?.name}</span>
                <button className="btn ghost sm" onClick={() => patch(l, { removed: false })}>Put back</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {list && (
        <div className="row">
          {list.status === "open"
            ? <button className="btn primary" onClick={markBought} disabled={!!busy}>Mark as bought</button>
            : <button className="btn" onClick={reopen}>Reopen this list</button>}
          <Link className="btn" href="/fridge">What&apos;s still in?</Link>
        </div>
      )}
    </main>
  );
}
