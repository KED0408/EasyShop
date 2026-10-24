"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { addDays, fmtDate } from "@/lib/plan";
import { fmtAmount } from "@/lib/shopping";
import type { PantryRow } from "@/lib/types";

/** "What's still in?" — the leftovers record, editable in seconds. */
export default function FridgePage() {
  const { items, itemMap, loading } = useHousehold();
  const [rows, setRows] = useState<PantryRow[] | null>(null);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from("pantry_stock").select("*").order("use_by", { nullsFirst: false });
    if (error) setError(error.message);
    setRows((data as PantryRow[]) ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function setRowQty(r: PantryRow, v: number) {
    const db = supabase();
    const res = v <= 0 ? await db.from("pantry_stock").delete().eq("id", r.id) : await db.from("pantry_stock").update({ qty: v }).eq("id", r.id);
    if (res.error) setError(res.error.message);
    load();
  }

  async function clearExpired() {
    const ids = (rows ?? []).filter((r) => r.use_by && r.use_by < today).map((r) => r.id);
    if (!ids.length) return;
    await supabase().from("pantry_stock").delete().in("id", ids);
    load();
  }

  async function add() {
    const it = items.find((i) => i.name.toLowerCase() === pick.trim().toLowerCase());
    if (!it) return setError("Pick an item from the list.");
    const n = Number(qty);
    if (!(n > 0)) return setError("Enter how much is left.");
    const { error } = await supabase().from("pantry_stock").insert({
      item_id: it.id, qty: n, source: "manual", use_by: it.keep_days ? addDays(today, it.keep_days) : null,
    });
    if (error) return setError(error.message);
    setPick(""); setQty(""); setError(null);
    load();
  }

  const expired = (rows ?? []).filter((r) => r.use_by && r.use_by < today).length;
  const addItem = items.find((i) => i.name.toLowerCase() === pick.trim().toLowerCase());

  return (
    <main className="page">
      <h1>What&apos;s still in?</h1>
      <p className="muted" style={{ margin: 0 }}>
        Spare from part-used packs, carried into the next weeks&apos; lists. A quick check once a week keeps the list accurate: set anything that&apos;s been used to 0.
      </p>
      {error && <p className="error small">{error}</p>}
      <section className="card">
        {rows === null || loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">Nothing recorded yet — leftovers are added when you mark a week as bought.</p> : (
          <table className="simple">
            <thead><tr><th>Item</th><th>Left</th><th>Use by</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const it = itemMap.get(r.item_id);
                if (!it) return null;
                const old = r.use_by && r.use_by < today;
                return (
                  <tr key={r.id} style={{ opacity: old ? 0.5 : 1 }}>
                    <td>{it.name}</td>
                    <td style={{ width: 110 }}>
                      <input type="number" defaultValue={Number(r.qty)} aria-label={`${it.name} left`} step={it.unit === "each" ? 1 : 10}
                        onBlur={(e) => Number(e.target.value) !== Number(r.qty) && setRowQty(r, Number(e.target.value))} />
                      <span className="muted small">{it.unit === "each" ? "" : it.unit} ({fmtAmount(it, Number(r.qty))})</span>
                    </td>
                    <td className="small">{r.use_by ? fmtDate(r.use_by) : "keeps"}{old ? " · past" : ""}</td>
                    <td><button className="btn ghost sm" aria-label={`Used up ${it.name}`} onClick={() => setRowQty(r, 0)}>Used</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {expired > 0 && <button className="btn sm" onClick={clearExpired}>Clear {expired} past use-by</button>}
      </section>
      <section className="card tight">
        <h3>Add something that&apos;s in</h3>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input type="text" list="fridge-items" placeholder="Item" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Item" />
          <datalist id="fridge-items">{items.filter((i) => !i.is_cupboard).map((i) => <option key={i.id} value={i.name} />)}</datalist>
          <input type="number" placeholder={addItem ? (addItem.unit === "each" ? "how many" : addItem.unit) : "amount"} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Amount" style={{ width: 110 }} />
          <button className="btn sm" onClick={add}>Add</button>
        </div>
      </section>
    </main>
  );
}
