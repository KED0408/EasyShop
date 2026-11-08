"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AISLE_ORDER, matchItem, parseLines, suggestCategory, tidyName } from "@/lib/shopping";
import type { Item } from "@/lib/types";
import { MEASURES } from "@/lib/measures";

type Freq = NonNullable<Item["buy_frequency"]>;
type Row = {
  name: string;
  category: string;
  frequency: Freq;
  brand: string;
  measure: string;
  existing: Item | null;   // already in the cupboard / item list
  action: "add" | "skip";
};

const FREQ: { v: Freq; label: string }[] = [
  { v: "weekly", label: "Every week" },
  { v: "fortnightly", label: "Every 2 weeks" },
  { v: "as_needed", label: "As needed" },
];

/**
 * Add many store-cupboard items in one go: paste a list or choose a .txt/.csv file, check the suggested
 * aisle for each (taken from similar items you already have), then import.
 * CSV columns: name, aisle (optional), how often (optional: weekly / fortnightly / as needed).
 */
export default function CupboardImport({ items, onDone, onClose }: { items: Item[]; onDone: (added: number, updated: number) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [defaultFreq, setDefaultFreq] = useState<Freq>("as_needed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aisles = [...new Set([...AISLE_ORDER, ...items.map((i) => i.category)])];

  function review(src = text, csv = false) {
    const lines = parseLines(src, { csv, aisles });
    setRows(lines.map((l) => {
      const name = tidyName(l.text);
      const exact = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
      const close = exact ?? matchItem(name, items)?.item ?? null;
      const sure = !!exact || (close && matchItem(name, items)!.score >= 0.75);
      return {
        name,
        category: l.category ?? (close && sure ? close.category : suggestCategory(name, items)),
        frequency: l.frequency ?? defaultFreq,
        brand: "",
        measure: /\bmilk\b/i.test(name) && !/chocolate|coconut|almond|oat|soya/i.test(name) ? "pint" : "pack",
        existing: sure ? close : null,
        // something already in the cupboard is skipped by default; a near-miss is shown but still added
        action: sure && close?.is_cupboard ? "skip" : "add",
      };
    }));
  }

  async function readFile(f: File | undefined) {
    if (!f) return;
    const t = await f.text();
    setText(t);
    review(t, /\.csv$/i.test(f.name));
  }

  async function importAll() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    const db = supabase();
    let added = 0, updated = 0;
    const fresh = rows.filter((r) => r.action === "add" && !r.existing);
    if (fresh.length) {
      const { error } = await db.from("items").insert(fresh.map((r) => {
        const m = MEASURES.find((x) => x.id === r.measure) ?? MEASURES[0];
        return {
          name: r.name, category: r.category, unit: m.base, measure: m.id, is_cupboard: true, buy_frequency: r.frequency,
          pack_size: m.factor, usual_qty: 1, brand_lock: r.brand.trim() || null,
        };
      }));
      if (error) { setBusy(false); return setError(error.message.includes("duplicate") ? "Two lines have the same name — remove one and try again." : error.message); }
      added = fresh.length;
    }
    // an item you already have (e.g. a meal ingredient) is put into the cupboard rather than duplicated
    for (const r of rows.filter((x) => x.action === "add" && x.existing)) {
      const { error } = await db.from("items").update({
        is_cupboard: true, buy_frequency: r.frequency, category: r.category, ...(r.brand.trim() ? { brand_lock: r.brand.trim() } : {}),
      }).eq("id", r.existing!.id);
      if (error) { setBusy(false); return setError(error.message); }
      updated++;
    }
    setBusy(false);
    onDone(added, updated);
  }

  const set = (i: number, p: Partial<Row>) => rows && setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const toAdd = rows?.filter((r) => r.action === "add").length ?? 0;

  return (
    <section className="card">
      <div className="row between">
        <h2>Import items</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      {!rows ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Paste one item per line, or choose a file. A CSV can have columns <b>name, aisle, how often</b>. Each item gets an aisle
            from similar things already in your cupboard — you can change any before importing.
          </p>
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Dishwasher tablets\nRed lentils\nOat milk\nSmoked paprika"} aria-label="Items to import" />
          <label className="field">How often for these (unless the file says)
            <select value={defaultFreq} onChange={(e) => setDefaultFreq(e.target.value as Freq)}>
              {FREQ.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="btn primary" onClick={() => review()} disabled={!text.trim()}>Check items</button>
            <label className="btn">
              Or choose a file (.txt / .csv)
              <input type="file" accept=".txt,.csv,text/plain,text/csv" style={{ display: "none" }} onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            {rows.length} items read. Anything already in your cupboard is set to <b>Skip</b>.
          </p>
          <ul className="list">
            {rows.map((r, i) => (
              <li key={i} className="stack" style={{ gap: 6, opacity: r.action === "skip" ? 0.55 : 1 }}>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="text" value={r.name} aria-label="Item name" onChange={(e) => set(i, { name: e.target.value })} />
                  <select aria-label={`Add or skip ${r.name}`} value={r.action} style={{ width: "auto" }} onChange={(e) => set(i, { action: e.target.value as Row["action"] })}>
                    <option value="add">{r.existing ? "Add to cupboard" : "Add"}</option>
                    <option value="skip">Skip</option>
                  </select>
                </div>
                {r.existing && (
                  <span className="small muted">
                    {r.existing.is_cupboard ? `Already in your cupboard as "${r.existing.name}".` : `You already have "${r.existing.name}" (a meal ingredient) — adding puts it in the cupboard too.`}
                  </span>
                )}
                {r.action === "add" && (
                  <div className="row">
                    <select aria-label={`Aisle for ${r.name}`} value={r.category} className="grow" style={{ width: "auto" }} onChange={(e) => set(i, { category: e.target.value })}>
                      {aisles.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <select aria-label={`How often for ${r.name}`} value={r.frequency} style={{ width: "auto" }} onChange={(e) => set(i, { frequency: e.target.value as Freq })}>
                      {FREQ.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
                    </select>
                    {!r.existing && (
                      <select aria-label={`Measured in for ${r.name}`} value={r.measure} style={{ width: "auto" }} onChange={(e) => set(i, { measure: e.target.value })}>
                        {MEASURES.map((x) => <option key={x.id} value={x.id}>{x.id === "each" ? "each" : x.many}</option>)}
                      </select>
                    )}
                    <input type="text" placeholder="Brand (optional)" value={r.brand} aria-label={`Brand for ${r.name}`} style={{ width: 150 }} onChange={(e) => set(i, { brand: e.target.value })} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
          <div className="row">
            <button className="btn primary" onClick={importAll} disabled={busy || !toAdd}>{busy ? "Importing…" : `Import ${toAdd} item${toAdd === 1 ? "" : "s"}`}</button>
            <button className="btn" onClick={() => setRows(null)}>Back</button>
          </div>
        </>
      )}
    </section>
  );
}
