"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import type { Member, Slot } from "@/lib/types";

const SKIPPABLE: Slot[] = ["breakfast", "lunch"];

function numOrNull(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function MemberCard({ member, onSaved }: { member: Member; onSaved: () => void }) {
  const [m, setM] = useState<Member>(member);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  const set = <K extends keyof Member>(k: K, v: Member[K]) => { setM({ ...m, [k]: v }); setState("idle"); };

  async function save() {
    setState("saving");
    const { error } = await supabase().from("members").update({
      name: m.name.trim() || member.name,
      portion_factor: m.portion_factor,
      kcal_target_office: m.kcal_target_office,
      kcal_target_other: m.kcal_target_other,
      protein_target_office: m.protein_target_office,
      protein_target_other: m.protein_target_other,
      skips_on_office_days: m.skips_on_office_days,
    }).eq("id", m.id);
    setState(error ? error.message : "saved");
    if (!error) onSaved();
  }

  return (
    <section className="card">
      <label className="field">Name<input type="text" value={m.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label className="field">
        Portion size
        <span className="hint">1.00 = the 64 kg Tracker portion. Every shared meal is scaled by this.</span>
        <input type="number" step="0.05" min="0.25" max="3" value={m.portion_factor}
          onChange={(e) => set("portion_factor", numOrNull(e.target.value) ?? 1)} />
      </label>
      <div className="row">
        <label className="field grow">Calorie target · office days
          <input type="number" inputMode="numeric" placeholder="none" value={m.kcal_target_office ?? ""} onChange={(e) => set("kcal_target_office", numOrNull(e.target.value))} />
        </label>
        <label className="field grow">Calorie target · other days
          <input type="number" inputMode="numeric" placeholder="none" value={m.kcal_target_other ?? ""} onChange={(e) => set("kcal_target_other", numOrNull(e.target.value))} />
        </label>
      </div>
      <div className="row">
        <label className="field grow">Protein target (g) · office days
          <input type="number" inputMode="numeric" placeholder="none" value={m.protein_target_office ?? ""} onChange={(e) => set("protein_target_office", numOrNull(e.target.value))} />
        </label>
        <label className="field grow">Protein target (g) · other days
          <input type="number" inputMode="numeric" placeholder="none" value={m.protein_target_other ?? ""} onChange={(e) => set("protein_target_other", numOrNull(e.target.value))} />
        </label>
      </div>
      <div className="stack">
        <b className="small">Skips on office days</b>
        <div className="chips">
          {SKIPPABLE.map((s) => {
            const on = m.skips_on_office_days.includes(s);
            return (
              <button key={s} type="button" className="chip" aria-pressed={on}
                onClick={() => set("skips_on_office_days", on ? m.skips_on_office_days.filter((x) => x !== s) : [...m.skips_on_office_days, s])}>
                {s === "breakfast" ? "Breakfast" : "Lunch"}
              </button>
            );
          })}
        </div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={save} disabled={state === "saving"}>Save</button>
        {state === "saved" && <span className="muted small">Saved</span>}
        {state !== "idle" && state !== "saving" && state !== "saved" && <span className="error small">{state}</span>}
      </div>
    </section>
  );
}

export default function HouseholdPage() {
  const { members, loading, error, reload } = useHousehold();
  return (
    <main className="page">
      <h1>Household</h1>
      <p className="muted" style={{ margin: 0 }}>
        Portions and targets for each person. Daily calorie and macro totals are shown for everyone on the plan;
        targets are optional and only add a warning when a day goes over.
      </p>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : members.map((m) => <MemberCard key={m.id} member={m} onSaved={reload} />)}
    </main>
  );
}
