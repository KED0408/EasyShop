"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AISLE_ORDER, matchItem, parseLines, suggestCategory, tidyName } from "@/lib/shopping";
import type { Item, LineSource } from "@/lib/types";

type Row = { text: string; qty: number; itemId: string | "new" | "skip"; category: string };

/**
 * Paste a list (or the Alexa list, or a .txt/.csv file), check what each line matched, then add it all
 * to the shopping list in one go. Anything new is saved to the store cupboard in a suggested aisle.
 */
export default function ListImport({ items, listId, source, onDone, onClose }: {
  items: Item[]; listId: string; source: Extract<LineSource, "alexa" | "added">; onDone: (added: number) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aisles = [...new Set([...AISLE_ORDER, ...items.map((i) => i.category)])];

  function match(src = text, csv = false) {
    const lines = parseLines(src, { csv, aisles });
    setRows(lines.map((l) => {
      const m = matchItem(l.text, items);
      return { text: l.text, qty: l.qty, itemId: m ? m.item.id : "new", category: l.category ?? suggestCategory(l.text, items) };
    }));
  }

  async function readFile(f: File | undefined) {
    if (!f) return;
    const t = await f.text();
    setText(t);
    match(t, /\.csv$/i.test(f.name));
  }

  async function addAll() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    const db = supabase();
    const want = new Map<string, number>();
    for (const r of rows) {
      if (r.itemId === "skip") continue;
      let id = r.itemId;
      if (id === "new") {
        const name = tidyName(r.text);
        const existing = items.find((it) => it.name.toLowerCase() === name.toLowerCase());
        if (existing) id = existing.id;
        else {
          const { data, error } = await db.from("items")
            .insert({ name, category: r.category, unit: "each", is_cupboard: true, buy_frequency: "as_needed", pack_size: 1 })
            .select().single();
          if (error) { setBusy(false); return setError(error.message); }
          id = (data as Item).id;
        }
      }
      want.set(id, (want.get(id) ?? 0) + r.qty);
    }
    if (want.size) {
      const { error } = await db.from("list_lines").upsert(
        [...want.entries()].map(([item_id, packs]) => ({ list_id: listId, item_id, source, packs, removed: false })),
        { onConflict: "list_id,item_id,source" },
      );
      if (error) { setBusy(false); return setError(error.message); }
    }
    setBusy(false);
    onDone(want.size);
  }

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const set = (i: number, p: Partial<Row>) => rows && setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <section className="card">
      <div className="row between">
        <h2>{source === "alexa" ? "Import the Alexa list" : "Paste a list"}</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      {!rows ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            {source === "alexa"
              ? <>In the Alexa app open <b>Lists → Shopping</b>, select and copy the items, then paste them here.</>
              : <>One item per line. Quantities are understood: &quot;2 x milk&quot;, &quot;milk x2&quot; or &quot;3 bananas&quot;.</>}
          </p>
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"2 x milk\ncoke zero\nloo roll\nbagels"} aria-label="Pasted list" />
          <div className="row">
            <button className="btn primary" onClick={() => match()} disabled={!text.trim()}>Match items</button>
            <label className="btn">
              Or choose a file (.txt / .csv)
              <input type="file" accept=".txt,.csv,text/plain,text/csv" style={{ display: "none" }} onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>Check each match and quantity. Anything new is saved to the store cupboard in the aisle shown.</p>
          <table className="simple">
            <thead><tr><th>Line</th><th>Qty</th><th>Matches</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.text}</td>
                  <td style={{ width: 70 }}>
                    <input type="number" min={1} max={24} value={r.qty} aria-label={`Quantity of ${r.text}`} onChange={(e) => set(i, { qty: Math.max(1, Number(e.target.value) || 1) })} />
                  </td>
                  <td>
                    <select aria-label={`Match for ${r.text}`} value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
                      <option value="new">New item: {tidyName(r.text)}</option>
                      <option value="skip">Skip this one</option>
                      {sorted.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </select>
                    {r.itemId === "new" && (
                      <select aria-label={`Aisle for ${r.text}`} value={r.category} style={{ marginTop: 4 }} onChange={(e) => set(i, { category: e.target.value })}>
                        {aisles.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
          <div className="row">
            <button className="btn primary" onClick={addAll} disabled={busy}>{busy ? "Adding…" : `Add ${rows.filter((r) => r.itemId !== "skip").length} items to the list`}</button>
            <button className="btn" onClick={() => setRows(null)}>Back</button>
          </div>
        </>
      )}
    </section>
  );
}
