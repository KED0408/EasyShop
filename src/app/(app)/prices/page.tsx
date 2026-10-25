"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { addDays, fmtDate } from "@/lib/plan";
import {
  budgetState, gbp, runnerOnline, STORE_NAME,
  type PriceCheck, type PriceLine, type RunnerJob, type Settings, type StoreId, type StoreProduct,
} from "@/lib/stores";
import type { ListLine, Plan, ShoppingList } from "@/lib/types";

type ListOpt = ShoppingList & { plan: Plan };

type FillOut = { store: StoreId; added: number; total: number; problems: { item: string; product: string; want: number; got: number; status: string; note: string | null }[]; not_priced: string[] };

const TROLLEY: Record<StoreId, string> = {
  tesco: "https://www.tesco.com/groceries/en-GB/trolley",
  sainsburys: "https://www.sainsburys.co.uk/gol-ui/trolley",
  morrisons: "https://groceries.morrisons.com/trolley",
  ocado: "https://www.ocado.com/trolley",
};

const STATUS: Record<string, string> = { partial: "only part added", not_found: "not found", failed: "couldn't add", signin: "sign-in needed" };

function FillResult({ r }: { r: FillOut }) {
  return (
    <div className="stack small" style={{ gap: 4 }}>
      <b>{r.added} of {r.total} items added to your {STORE_NAME[r.store]} trolley.</b>
      {r.problems.length > 0 && (
        <ul className="list">
          {r.problems.map((p) => (
            <li key={p.item}><b>{p.item}</b> — {STATUS[p.status] ?? p.status}{p.status === "partial" ? ` (${p.got} of ${p.want})` : ""}. Add it yourself in the {STORE_NAME[r.store]} app.</li>
          ))}
        </ul>
      )}
      {r.not_priced.length > 0 && <span className="muted">Not available at {STORE_NAME[r.store]}: {r.not_priced.join(", ")}</span>}
      <a className="btn primary sm" style={{ alignSelf: "flex-start" }} href={TROLLEY[r.store]} target="_blank" rel="noopener noreferrer">Open {STORE_NAME[r.store]} trolley → book &amp; pay</a>
    </div>
  );
}

export default function PricesPage() {
  const { itemMap } = useHousehold();
  const [lists, setLists] = useState<ListOpt[] | null>(null);
  const [listId, setListId] = useState<string>("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [check, setCheck] = useState<PriceCheck | null>(null);
  const [lines, setLines] = useState<PriceLine[]>([]);
  const [listLines, setListLines] = useState<ListLine[]>([]);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [job, setJob] = useState<RunnerJob | null>(null);
  const [open, setOpen] = useState<StoreId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = supabase();
    db.from("settings").select("*").eq("id", 1).single().then(({ data }) => setSettings(data as Settings));
    db.from("shopping_lists").select("*, plan:plans(*)").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error) setError(error.message);
      const ls = ((data as ListOpt[]) ?? []).filter((l) => l.plan);
      setLists(ls);
      const pick = ls.find((l) => l.status === "open") ?? ls[0];
      if (pick) setListId(pick.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!listId) return;
    const db = supabase();
    const [c, j, ll, s] = await Promise.all([
      db.from("price_checks").select("*").eq("list_id", listId).order("created_at", { ascending: false }).limit(1),
      db.from("runner_jobs").select("*").contains("payload", { list_id: listId }).order("created_at", { ascending: false }).limit(1),
      db.from("list_lines").select("*").eq("list_id", listId),
      db.from("settings").select("*").eq("id", 1).single(),
    ]);
    const pc = (c.data?.[0] as PriceCheck) ?? null;
    setCheck(pc);
    setJob((j.data?.[0] as RunnerJob) ?? null);
    setListLines((ll.data as ListLine[]) ?? []);
    setSettings(s.data as Settings);
    if (pc) {
      const { data } = await db.from("price_lines").select("*").eq("check_id", pc.id);
      setLines((data as PriceLine[]) ?? []);
    } else setLines([]);
    const ids = [...new Set(((ll.data as ListLine[]) ?? []).map((l) => l.item_id))];
    if (ids.length) {
      const { data } = await db.from("store_products").select("*").in("item_id", ids);
      setProducts((data as StoreProduct[]) ?? []);
    }
  }, [listId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // keep watching while a job is waiting or running
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [job, load]);

  async function queue(type: "match" | "price" | "fill", store?: StoreId) {
    if (!listId) return;
    if (type === "fill" && !window.confirm(`Add this week's list to your ${STORE_NAME[store!]} trolley?\n\nTip: empty that trolley first if it has old items in it. EasyShop won't book a slot or pay.`)) return;
    setError(null);
    const payload = type === "fill" ? { list_id: listId, store } : { list_id: listId, stores: settings?.stores };
    const { data, error } = await supabase().from("runner_jobs").insert({ type, payload }).select().single();
    if (error) return setError(error.message);
    setJob(data as RunnerJob);
  }

  const list = lists?.find((l) => l.id === listId);
  const stores = (settings?.stores ?? []) as StoreId[];
  const ranked = useMemo(() => (check ? stores.filter((s) => check.totals[s]).sort((a, b) => check.totals[a]!.compare - check.totals[b]!.compare) : []), [check, stores]);
  const best = check?.cheapest ?? null;
  const bestTotal = best && check ? check.totals[best]!.total : null;
  const bState = bestTotal != null ? budgetState(bestTotal, settings) : "none";

  // Checkpoint 1: an estimate from last known prices, before any check has run this week
  const estimate = useMemo(() => {
    const toBuy = listLines.filter((l) => !l.removed && !l.have_it && l.packs > 0);
    if (!toBuy.length || !products.length) return null;
    let sum = 0, known = 0;
    for (const l of toBuy) {
      const prices = products.filter((p) => p.item_id === l.item_id && p.status !== "none" && p.last_price != null).map((p) => Number(p.last_price));
      if (prices.length) { sum += Math.min(...prices) * l.packs; known++; }
    }
    return known ? { sum, known, of: toBuy.length } : null;
  }, [listLines, products]);

  const help = useMemo(() => {
    if (!best || bState === "none" || bState === "ok") return null;
    const at = lines.filter((l) => l.store === best && l.line_total != null);
    const top = [...at].sort((a, b) => Number(b.line_total) - Number(a.line_total)).slice(0, 5);
    const extras = listLines.filter((l) => !l.removed && !l.have_it && l.source !== "meal")
      .map((l) => ({ l, cost: at.find((p) => p.item_id === l.item_id)?.line_total ?? null }))
      .filter((x) => x.cost != null).sort((a, b) => Number(b.cost) - Number(a.cost)).slice(0, 6);
    const swaps: { name: string; current: string; cheaper: string; save: number; sp: StoreProduct; alt: StoreProduct["candidates"][number] }[] = [];
    for (const p of at) {
      const it = itemMap.get(p.item_id);
      if (!it || it.brand_lock) continue;
      const sp = products.find((x) => x.item_id === p.item_id && x.store === best);
      const unit = p.member_price ?? p.unit_price;
      if (!sp || unit == null) continue;
      const alt = sp.candidates.filter((c) => c.inStock && c.url !== p.url && (c.memberPrice ?? c.price) != null && (c.memberPrice ?? c.price)! < unit * 0.85)
        .sort((a, b) => (a.memberPrice ?? a.price)! - (b.memberPrice ?? b.price)!)[0];
      if (alt) swaps.push({ name: it.name, current: p.product_name ?? "", cheaper: `${alt.name} (${gbp(alt.memberPrice ?? alt.price)})`, save: (unit - (alt.memberPrice ?? alt.price)!) * p.qty, sp, alt });
    }
    swaps.sort((a, b) => b.save - a.save);
    return { top, extras, swaps: swaps.slice(0, 5) };
  }, [best, bState, lines, listLines, products, itemMap]);

  const [changed, setChanged] = useState<Set<string>>(new Set());

  /** Use the cheaper product from now on (approved, so it's reused every week). */
  async function swap(sp: StoreProduct, alt: StoreProduct["candidates"][number]) {
    const { error } = await supabase().from("store_products").update({
      status: "approved", product_name: alt.name, url: alt.url, size_text: alt.size, size_qty: null,
      last_price: alt.memberPrice ?? alt.price, updated_at: new Date().toISOString(),
    }).eq("id", sp.id);
    if (error) return setError(error.message);
    setChanged(new Set(changed).add(sp.id));
  }

  /** Take an extra off this week's list (it can be put back from the List page). */
  async function leaveOut(line: ListLine) {
    const { error } = await supabase().from("list_lines").update({ removed: true }).eq("id", line.id);
    if (error) return setError(error.message);
    setChanged(new Set(changed).add(line.id));
  }

  const busy = job && (job.status === "queued" || job.status === "running");
  const online = runnerOnline(settings);
  const unmatched = useMemo(() => {
    const ids = [...new Set(listLines.filter((l) => !l.removed && !l.have_it && l.packs > 0).map((l) => l.item_id))];
    return ids.filter((id) => stores.some((s) => !products.find((p) => p.item_id === id && p.store === s))).length;
  }, [listLines, products, stores]);
  const toApprove = products.filter((p) => p.status === "suggested").length;

  return (
    <main className="page">
      <div className="row between">
        <h1>Prices</h1>
        <Link className="btn ghost sm" href="/settings">Settings</Link>
      </div>

      {lists && lists.length === 0 && <p>Open the <Link href="/list">shopping list</Link> for a week first.</p>}
      {lists && lists.length > 0 && (
        <select aria-label="Shopping list" value={listId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.plan.name} · Week {l.week + 1} ({fmtDate(addDays(l.plan.start_date, l.week * 7))}){l.status === "bought" ? " · bought" : ""}
            </option>
          ))}
        </select>
      )}

      <section className="card tight">
        <div className="row between">
          <span>{online ? <span className="tag">Laptop online</span> : <span className="tag warn">Laptop offline</span>}</span>
          <span className="muted small">{online ? "Jobs start within a minute." : "Jobs wait until the laptop is switched on."}</span>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => queue("price")} disabled={!!busy || !listId}>Check prices</button>
          <button className="btn" onClick={() => queue("match")} disabled={!!busy || !listId}>Find products</button>
          <Link className="btn" href={`/prices/matches?list=${listId}`}>Products{toApprove ? ` (${toApprove} to check)` : ""}</Link>
        </div>
        {unmatched > 0 && !busy && <p className="muted small" style={{ margin: 0 }}>{unmatched} items haven&apos;t been looked up yet — Check prices finds them first (it takes longer the first time).</p>}
        {job && (
          <p className="small" style={{ margin: 0 }}>
            <b>{job.type === "match" ? "Finding products" : job.type === "fill" ? "Filling the basket" : "Price check"}:</b>{" "}
            {job.status === "queued" ? "waiting for the laptop…" : job.status === "running" ? job.progress ?? "running…" : job.status === "failed" ? <span className="error">failed — {job.error}</span> : `finished ${new Date(job.finished_at ?? job.created_at).toLocaleString("en-GB")}`}
          </p>
        )}
        {job?.result?.errors?.length ? <ul className="small error" style={{ margin: 0 }}>{job.result.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        {job?.type === "fill" && job.status === "done" && job.result && <FillResult r={job.result as unknown as FillOut} />}
      </section>

      {!check && estimate && settings?.weekly_budget && (
        <p className={budgetState(estimate.sum, settings) === "over" ? "notice" : "muted small"}>
          Estimate from last known prices: about {gbp(estimate.sum)} for {estimate.known} of {estimate.of} items · budget {gbp(settings.weekly_budget)}.
        </p>
      )}

      {check && (
        <>
          {bState === "over" && (
            <p className="notice" role="alert"><b>Over budget:</b> this week&apos;s shop is {gbp(bestTotal)}, {gbp(bestTotal! - settings!.weekly_budget!)} over your {gbp(settings!.weekly_budget)} budget.</p>
          )}
          {bState === "near" && (
            <p className="notice" role="status">Close to budget: {gbp(bestTotal)} of your {gbp(settings!.weekly_budget)} ({Math.round((bestTotal! / settings!.weekly_budget!) * 100)}%).</p>
          )}

          <section className="card">
            <div className="row between">
              <h2>{best ? `Cheapest: ${STORE_NAME[best]}` : "Comparison"}</h2>
              <span className="muted small">Checked {new Date(check.created_at).toLocaleString("en-GB")}</span>
            </div>
            <table className="simple">
              <thead><tr><th>Store</th><th>Items</th><th>Delivery</th><th>Total</th><th>Missing</th></tr></thead>
              <tbody>
                {ranked.map((s) => {
                  const t = check.totals[s]!;
                  return (
                    <tr key={s} style={{ fontWeight: s === best ? 700 : 400, cursor: "pointer" }} onClick={() => setOpen(open === s ? null : s)}>
                      <td>{STORE_NAME[s]}{t.under_min && <span className="tag warn" style={{ marginLeft: 6 }}>under £{t.min_spend} min</span>}</td>
                      <td className="num">{gbp(t.items)}</td>
                      <td className="num">{gbp(t.delivery)}</td>
                      <td className="num">{gbp(t.total)}</td>
                      <td className="num">{t.missing || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small" style={{ margin: 0 }}>
              {best && <button className="btn primary" style={{ marginBottom: 8 }} onClick={() => queue("fill", best)} disabled={!!busy}>Fill {STORE_NAME[best]} basket</button>}
              <br />Ranked on the total with missing items estimated at other stores&apos; prices. Tesco uses Clubcard prices; Sainsbury&apos;s Nectar prices are not used. Tap a store for its lines.
            </p>
          </section>

          {help && (
            <section className="card">
              <h2>Getting back under budget</h2>
              {help.swaps.length > 0 && (<>
                <h3>Cheaper swaps at {STORE_NAME[best!]}</h3>
                <ul className="list small">{help.swaps.map((s) => (
                  <li key={s.name} className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                    <span className="grow"><b>{s.name}</b>: {s.cheaper} instead of {s.current} — save about {gbp(s.save)}</span>
                    {changed.has(s.sp.id) ? <span className="tag">Swapped</span> : <button className="btn sm" onClick={() => swap(s.sp, s.alt)}>Swap</button>}
                  </li>
                ))}</ul>
              </>)}
              {help.extras.length > 0 && (<>
                <h3>Extras that could wait a week</h3>
                <ul className="list small">{help.extras.map(({ l, cost }) => (
                  <li key={l.id} className="row between" style={{ flexWrap: "nowrap" }}>
                    <span className="grow">{itemMap.get(l.item_id)?.name} · {gbp(cost)}</span>
                    {changed.has(l.id) ? <span className="tag">Left out</span> : <button className="btn sm" onClick={() => leaveOut(l)}>Leave out this week</button>}
                  </li>
                ))}</ul>
              </>)}
              <h3>Most expensive lines</h3>
              <ul className="list small">{help.top.map((p) => <li key={p.id}>{itemMap.get(p.item_id)?.name} · {p.qty} × {p.product_name} · {gbp(p.line_total)}</li>)}</ul>
              {changed.size > 0 && (
                <p className="notice" style={{ margin: 0 }}>
                  {changed.size} change{changed.size === 1 ? "" : "s"} made. Tap <b>Check prices</b> to update the totals.
                </p>
              )}
              <div className="row">
                {changed.size > 0 && <button className="btn primary sm" onClick={() => { setChanged(new Set()); queue("price"); }} disabled={!!busy}>Check prices again</button>}
                <Link className="btn sm" href="/list">Edit the list</Link>
              </div>
            </section>
          )}

          {open && (
            <section className="card">
              <div className="row between">
                <h2>{STORE_NAME[open]} lines</h2>
                <button className="btn primary sm" onClick={() => queue("fill", open)} disabled={!!busy}>Fill {STORE_NAME[open]} basket</button>
              </div>
              <table className="simple">
                <thead><tr><th>Item</th><th>Product</th><th>Qty</th><th>Total</th></tr></thead>
                <tbody>
                  {lines.filter((l) => l.store === open).sort((a, b) => (itemMap.get(a.item_id)?.name ?? "").localeCompare(itemMap.get(b.item_id)?.name ?? "")).map((l) => (
                    <tr key={l.id} style={{ opacity: l.line_total == null || !l.in_stock ? 0.5 : 1 }}>
                      <td>{itemMap.get(l.item_id)?.name}</td>
                      <td className="small">
                        {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.product_name}</a> : <span className="muted">Not found</span>}
                        {l.member_price != null && <span className="tag" style={{ marginLeft: 4 }}>Clubcard {gbp(l.member_price)}</span>}
                        {l.offer_text && <div className="muted">{l.offer_text}</div>}
                        {!l.in_stock && l.url && <div className="error">Out of stock</div>}
                      </td>
                      <td className="num">{l.qty || ""}</td>
                      <td className="num">{gbp(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      {error && <p className="error small">{error}</p>}
      {list && <p className="muted small">List: {list.plan.name}, week {list.week + 1}. Change what&apos;s on it from the <Link href="/list">List</Link> tab.</p>}
    </main>
  );
}
