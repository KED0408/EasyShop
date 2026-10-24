"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { gbp, STORES, STORE_NAME, type Settings, type StoreId, type StoreProduct } from "@/lib/stores";
import type { ListLine } from "@/lib/types";

function Cell({ sp, onChange }: { sp: StoreProduct | undefined; onChange: (p: Partial<StoreProduct>) => void }) {
  if (!sp) return <span className="muted small">Not looked up yet</span>;
  const value = sp.status === "none" ? "__none" : sp.url ?? "";
  return (
    <div className="stack" style={{ gap: 4 }}>
      <select aria-label="Product" value={value} onChange={(e) => {
        const v = e.target.value;
        if (v === "__none") return onChange({ status: "none" });
        const c = sp.candidates.find((x) => x.url === v);
        if (c) onChange({ status: "approved", product_name: c.name, url: c.url, size_text: c.size, last_price: c.memberPrice ?? c.price, size_qty: null });
      }}>
        {sp.url && !sp.candidates.some((c) => c.url === sp.url) && <option value={sp.url}>{sp.product_name}</option>}
        {!sp.url && sp.status !== "none" && <option value="">No good match found</option>}
        {sp.candidates.map((c) => (
          <option key={c.url} value={c.url}>{c.name}{c.size ? ` · ${c.size.split(" Ordinarily")[0]}` : ""} · {gbp(c.memberPrice ?? c.price)}{c.offer ? " · offer" : ""}</option>
        ))}
        <option value="__none">Don&apos;t buy here</option>
      </select>
      <div className="row small" style={{ gap: 6 }}>
        {sp.status === "approved" ? <span className="tag">Approved</span> : sp.status === "none" ? <span className="tag warn">Skipped</span> : <span className="tag warn">Suggested</span>}
        {sp.last_price != null && <span className="muted">{gbp(sp.last_price)}</span>}
        {sp.status === "suggested" && sp.url && <button className="btn ghost sm" onClick={() => onChange({ status: "approved" })}>Approve</button>}
      </div>
    </div>
  );
}

function Matches() {
  const params = useSearchParams();
  const listId = params.get("list");
  const { itemMap } = useHousehold();
  const [rows, setRows] = useState<StoreProduct[]>([]);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [stores, setStores] = useState<StoreId[]>(STORES);
  const [store, setStore] = useState<StoreId | "all">("all");
  const [onlyToCheck, setOnlyToCheck] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
    if (s) setStores((s as Settings).stores);
    let ids: string[] = [];
    if (listId) {
      const { data } = await db.from("list_lines").select("*").eq("list_id", listId);
      ids = [...new Set(((data as ListLine[]) ?? []).filter((l) => !l.removed && !l.have_it && l.packs > 0).map((l) => l.item_id))];
    }
    setItemIds(ids);
    const q = db.from("store_products").select("*");
    const { data } = ids.length ? await q.in("item_id", ids) : await q;
    setRows((data as StoreProduct[]) ?? []);
    if (!ids.length) setItemIds([...new Set(((data as StoreProduct[]) ?? []).map((r) => r.item_id))]);
  }, [listId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function change(sp: StoreProduct, p: Partial<StoreProduct>) {
    setRows(rows.map((r) => (r.id === sp.id ? { ...r, ...p } : r)));
    const { error } = await supabase().from("store_products").update({ ...p, updated_at: new Date().toISOString() }).eq("id", sp.id);
    if (error) setMsg(error.message);
  }

  async function approveAll() {
    const ids = rows.filter((r) => r.status === "suggested" && r.url && (store === "all" || r.store === store)).map((r) => r.id);
    if (!ids.length) return;
    const { error } = await supabase().from("store_products").update({ status: "approved" }).in("id", ids);
    if (error) return setMsg(error.message);
    setMsg(`${ids.length} matches approved.`);
    load();
  }

  const shownStores = store === "all" ? stores : [store];
  const items = useMemo(() => itemIds
    .map((id) => itemMap.get(id)).filter((i): i is NonNullable<typeof i> => !!i)
    .filter((i) => !onlyToCheck || shownStores.some((s) => { const r = rows.find((x) => x.item_id === i.id && x.store === s); return !r || r.status === "suggested"; }))
    .sort((a, b) => a.name.localeCompare(b.name)), [itemIds, itemMap, onlyToCheck, shownStores, rows]);

  return (
    <main className="page">
      <Link href="/prices" className="small">← Prices</Link>
      <h1>Products at each store</h1>
      <p className="muted" style={{ margin: 0 }}>
        The runner suggests the cheapest product that matches each item (your brand where one is set). Check them once —
        approved choices are reused every week. Pick &quot;Don&apos;t buy here&quot; for anything a store doesn&apos;t sell.
      </p>
      <div className="chips">
        <button className="chip" aria-pressed={store === "all"} onClick={() => setStore("all")}>All stores</button>
        {stores.map((s) => <button key={s} className="chip" aria-pressed={store === s} onClick={() => setStore(s)}>{STORE_NAME[s]}</button>)}
        <button className="chip" aria-pressed={onlyToCheck} onClick={() => setOnlyToCheck(!onlyToCheck)}>Only ones to check</button>
      </div>
      <div className="row">
        <button className="btn sm" onClick={approveAll}>Approve all suggestions{store !== "all" ? ` at ${STORE_NAME[store]}` : ""}</button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
      {items.length === 0 && <p className="muted">Nothing to check. {rows.length === 0 && "Run Find products from the Prices page first."}</p>}
      {items.map((it) => (
        <section key={it.id} className="card tight">
          <b>{it.name}{it.brand_lock ? ` · ${it.brand_lock} only` : ""}</b>
          {shownStores.map((s) => (
            <div key={s} className="stack" style={{ gap: 2 }}>
              <span className="small muted">{STORE_NAME[s]}</span>
              <Cell sp={rows.find((r) => r.item_id === it.id && r.store === s)} onChange={(p) => { const r = rows.find((x) => x.item_id === it.id && x.store === s); if (r) change(r, p); }} />
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

export default function MatchesPage() {
  return <Suspense fallback={<main className="page"><p className="muted">Loading…</p></main>}><Matches /></Suspense>;
}
