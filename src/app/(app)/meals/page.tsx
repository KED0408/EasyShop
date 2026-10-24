"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useHousehold } from "@/lib/useHousehold";
import { mealPerServing, r } from "@/lib/nutrition";
import { SLOTS, type Slot } from "@/lib/types";

const SLOT_NAME: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snacks", dinner: "Dinner" };

export default function MealsPage() {
  const { meals, itemMap, loading, error } = useHousehold();
  const [slot, setSlot] = useState<Slot | "all">("all");
  const [q, setQ] = useState("");

  const shown = useMemo(
    () => meals
      .filter((m) => !m.archived)
      .filter((m) => slot === "all" || m.slots.includes(slot))
      .filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [meals, slot, q],
  );

  return (
    <main className="page">
      <div className="row between">
        <h1>Meals</h1>
        <Link className="btn primary" href="/meals/new">New meal</Link>
      </div>
      <input type="text" placeholder="Search meals" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search meals" />
      <div className="chips">
        <button className="chip" aria-pressed={slot === "all"} onClick={() => setSlot("all")}>All</button>
        {SLOTS.map((s) => (
          <button key={s} className="chip" aria-pressed={slot === s} onClick={() => setSlot(s)}>{SLOT_NAME[s]}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <section className="card">
        {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No meals match.</p> : (
          <ul className="list">
            {shown.map((m) => {
              const n = mealPerServing(m, m.meal_components ?? [], itemMap);
              return (
                <li key={m.id}>
                  <Link className="rowlink" href={`/meals/${m.id}`}>
                    <span className="grow">
                      <b>{m.name}</b>
                      <br />
                      <span className="muted small">
                        {m.slots.map((s) => SLOT_NAME[s]).join(" · ")}
                        {m.source === "tracker" ? " · 64 kg Tracker" : ""}
                        {m.is_batch ? " · batch" : ""}
                      </span>
                    </span>
                    <span className="small num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <b>{r(n.kcal)} kcal</b><br />
                      <span className="muted">P {r(n.protein)} · C {r(n.carbs)} · F {r(n.fat)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="muted small" style={{ margin: 0 }}>Figures are per standard (64 kg Tracker) portion.</p>
    </main>
  );
}
