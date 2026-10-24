"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { guessCategory, matchItem, parsePasted, tidyName, AISLE_ORDER } from "@/lib/shopping";
import type { Item } from "@/lib/types";

type Row = { text: string; itemId: string | "new" | "skip"; category: string };

/** Paste the Alexa shopping list, check the matches, then add everything to this week's list. */
export default function AlexaImport({ items, listId, onDone, onClose }: {
  items: Item[]; listId: string; onDone: (added: number) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function match() {
    const lines = parsePasted(text);
    setRows(lines.map((t) => {
      const m = matchItem(t, items);
      return { text: t, itemId: m ? m.item.id : "new", category: guessCategory(t) };
    }));
  }

  async function addAll() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    const db = supabase();
    const ids: string[] = [];
    for (const r of rows) {
      if (r.itemId === "skip") continue;
      if (r.itemId === "new") {
        const name = tidyName(r.text);
        const existing = items.find((it) => it.name.toLowerCase() === name.toLowerCase());
        if (existing) { ids.push(existing.id); continue; }
        const { data, error } = await db.from("items")
          .insert({ name, category: r.category, unit: "each", is_cupboard: true, buy_frequency: "as_needed", pack_size: 1 })
          .select().single();
        if (error) { setBusy(false); return setError(error.message); }
        ids.push((data as Item).id);
      } else ids.push(r.itemId);
    }
    const unique = [...new Set(ids)];
    if (unique.length) {
      const { error } = await db.from("list_lines").upsert(
        unique.map((item_id) => ({ list_id: listId, item_id, source: "alexa", packs: 1, removed: false })),
        { onConflict: "list_id,item_id,source" },
      );
      if (error) { setBusy(false); return setError(error.message); }
    }
    setBusy(false);
    onDone(unique.length);
  }

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="card">
      <div className="row between">
        <h2>Import the Alexa list</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      {!rows ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            In the Alexa app open <b>Lists → Shopping</b>, select and copy the items (or type them), then paste them here — one per line.
          </p>
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"milk\ncoke zero\nloo roll\nbagels"} aria-label="Pasted Alexa list" />
          <button className="btn primary" onClick={match} disabled={!text.trim()}>Match items</button>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>Check each match. Anything new is saved to the store cupboard.</p>
          <table className="simple">
            <thead><tr><th>From Alexa</th><th>Matches</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.text}</td>
                  <td>
                    <select aria-label={`Match for ${r.text}`} value={r.itemId}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                      <option value="new">New item: {tidyName(r.text)}</option>
                      <option value="skip">Skip this one</option>
                      {sorted.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </select>
                    {r.itemId === "new" && (
                      <select aria-label={`Aisle for ${r.text}`} value={r.category} style={{ marginTop: 4 }}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
                        {AISLE_ORDER.map((c) => <option key={c}>{c}</option>)}
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
