"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { AISLE_ORDER, guessCategory, tidyName } from "@/lib/shopping";
import type { Item } from "@/lib/types";

const FREQ: { v: NonNullable<Item["buy_frequency"]>; label: string }[] = [
  { v: "weekly", label: "Every week" },
  { v: "fortnightly", label: "Every 2 weeks" },
  { v: "as_needed", label: "As needed" },
];

function CupboardRow({ item, onSaved }: { item: Item; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [it, setIt] = useState(item);
  const [err, setErr] = useState<string | null>(null);

  async function save(p: Partial<Item>) {
    const next = { ...it, ...p };
    setIt(next);
    const { error } = await supabase().from("items").update(p).eq("id", item.id);
    if (error) setErr(error.message);
    else onSaved();
  }

  return (
    <li>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <button className="grow" onClick={() => setOpen(!open)} aria-expanded={open}
          style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
          <b>{it.name}</b>
          <br />
          <span className="muted small">
            {it.usual_pack ?? ""}{it.brand_lock ? ` · ${it.brand_lock} only` : " · any brand"}
          </span>
        </button>
        <select aria-label={`How often for ${it.name}`} value={it.buy_frequency ?? "as_needed"} style={{ width: "auto" }}
          onChange={(e) => save({ buy_frequency: e.target.value as Item["buy_frequency"] })}>
          {FREQ.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
        </select>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: 8 }}>
          <label className="field">Name<input type="text" defaultValue={it.name} onBlur={(e) => e.target.value.trim() && e.target.value !== it.name && save({ name: e.target.value.trim() })} /></label>
          <div className="row">
            <label className="field grow">Usual pack<input type="text" defaultValue={it.usual_pack ?? ""} placeholder="e.g. 8 × 330 ml" onBlur={(e) => save({ usual_pack: e.target.value.trim() || null })} /></label>
            <label className="field grow">Brand
              <span className="hint">Leave empty for the cheapest equivalent</span>
              <input type="text" defaultValue={it.brand_lock ?? ""} placeholder="Any brand" onBlur={(e) => save({ brand_lock: e.target.value.trim() || null })} />
            </label>
          </div>
          <label className="field">Aisle
            <select value={it.category} onChange={(e) => save({ category: e.target.value })}>
              {AISLE_ORDER.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="btn ghost sm danger" onClick={() => save({ is_cupboard: false })}>Remove from store cupboard</button>
          </div>
          {err && <p className="error small">{err}</p>}
        </div>
      )}
    </li>
  );
}

export default function CupboardPage() {
  const { items, loading, error, reload } = useHousehold();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [onlyRegular, setOnlyRegular] = useState(false);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const cupboard = items.filter((i) => i.is_cupboard);
  const cats = AISLE_ORDER.filter((c) => cupboard.some((i) => i.category === c));
  const shown = cupboard
    .filter((i) => cat === "all" || i.category === cat)
    .filter((i) => !onlyRegular || i.buy_frequency === "weekly" || i.buy_frequency === "fortnightly")
    .filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()) || (i.brand_lock ?? "").toLowerCase().includes(q.trim().toLowerCase()));

  async function add() {
    const name = tidyName(newName);
    if (!name) return;
    const existing = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    const res = existing
      ? await supabase().from("items").update({ is_cupboard: true, buy_frequency: existing.buy_frequency ?? "as_needed" }).eq("id", existing.id)
      : await supabase().from("items").insert({ name, category: guessCategory(name), unit: "each", is_cupboard: true, buy_frequency: "as_needed", pack_size: 1 });
    if (res.error) return setMsg(res.error.message);
    setNewName("");
    setMsg(`${name} added to the store cupboard.`);
    reload();
  }

  const byCat = AISLE_ORDER.map((c) => [c, shown.filter((i) => i.category === c)] as const).filter(([, l]) => l.length);

  return (
    <main className="page">
      <h1>Store cupboard</h1>
      <p className="muted" style={{ margin: 0 }}>
        Your regular buys outside the meal plan. <b>Every week</b> and <b>Every 2 weeks</b> items are added to the list automatically.
      </p>
      <section className="card tight">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input type="text" placeholder="New item, e.g. Dishwasher tablets" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} aria-label="New store-cupboard item" />
          <button className="btn primary sm" onClick={add}>Add</button>
        </div>
        {msg && <p className="muted small" style={{ margin: 0 }}>{msg}</p>}
      </section>
      <input type="text" placeholder="Search the cupboard" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the cupboard" />
      <div className="chips">
        <button className="chip" aria-pressed={onlyRegular} onClick={() => setOnlyRegular(!onlyRegular)}>Regulars only</button>
        <button className="chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>All aisles</button>
        {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : byCat.map(([c, list]) => (
        <section key={c} className="card tight">
          <h3>{c}</h3>
          <ul className="list">{list.map((i) => <CupboardRow key={i.id} item={i} onSaved={reload} />)}</ul>
        </section>
      ))}
    </main>
  );
}
