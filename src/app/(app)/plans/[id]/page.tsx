"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { add, mealPerServing, r, scale, ZERO } from "@/lib/nutrition";
import { addDays, DAY_LONG, fmtDate, rowsFor, slotLabel, targetFor, weekday } from "@/lib/plan";
import { SLOTS, type DayType, type Macros, type Meal, type Member, type Plan, type PlanDay, type PlanSlot, type Slot } from "@/lib/types";

const DAY_TYPES: { v: DayType; label: string }[] = [
  { v: "office", label: "Office" },
  { v: "home", label: "Home" },
  { v: "weekend", label: "Weekend" },
];

function MealSelect({ value, slot, meals, onChange, allowNone, label }: {
  value: string | null; slot: Slot; meals: Meal[]; onChange: (v: string | null) => void; allowNone?: boolean; label: string;
}) {
  const fits = meals.filter((m) => !m.archived && m.slots.includes(slot));
  const others = meals.filter((m) => !m.archived && !m.slots.includes(slot));
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{allowNone ? "Nothing" : "Choose a meal…"}</option>
      <optgroup label="Suggested for this slot">{fits.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
      <optgroup label="Other meals">{others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
    </select>
  );
}

export default function PlanEditor() {
  const { id } = useParams<{ id: string }>();
  const { members, meals, mealMap, itemMap, loading } = useHousehold();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState<PlanDay[]>([]);
  const [slots, setSlots] = useState<PlanSlot[]>([]);
  const [week, setWeek] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const [p, d, s] = await Promise.all([
      db.from("plans").select("*").eq("id", id).single(),
      db.from("plan_days").select("*").eq("plan_id", id).order("day"),
      db.from("plan_slots").select("*").eq("plan_id", id).order("position"),
    ]);
    if (p.error) setError(p.error.message);
    setPlan(p.data as Plan);
    setDays((d.data as PlanDay[]) ?? []);
    setSlots((s.data as PlanSlot[]) ?? []);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const perServing = useMemo(() => {
    const m = new Map<string, Macros>();
    meals.forEach((meal) => m.set(meal.id, mealPerServing(meal, meal.meal_components ?? [], itemMap)));
    return m;
  }, [meals, itemMap]);

  const dayType = (day: string): DayType => days.find((d) => d.day === day)?.day_type ?? "home";

  // ---- writes (optimistic) ----
  async function run<T>(p: PromiseLike<{ error: { message: string } | null; data?: T }>) {
    const { error } = await p;
    if (error) { setError(error.message); load(); }
  }

  function setDayType(day: string, t: DayType) {
    setDays(days.map((d) => (d.day === day ? { ...d, day_type: t } : d)));
    run(supabase().from("plan_days").update({ day_type: t }).eq("plan_id", id).eq("day", day));
  }

  async function addRow(day: string, slot: Slot, memberId: string | null, mealId: string | null) {
    const position = slots.filter((s) => s.day === day && s.slot === slot).length;
    const { data, error } = await supabase().from("plan_slots")
      .insert({ plan_id: id, day, slot, member_id: memberId, meal_id: mealId, portions: 1, position }).select().single();
    if (error) return setError(error.message);
    setSlots((cur) => [...cur, data as PlanSlot]);
  }

  function updateRow(row: PlanSlot, patch: Partial<PlanSlot>) {
    setSlots(slots.map((s) => (s.id === row.id ? { ...s, ...patch } : s)));
    run(supabase().from("plan_slots").update(patch).eq("id", row.id));
  }

  function removeRow(row: PlanSlot) {
    setSlots(slots.filter((s) => s.id !== row.id));
    run(supabase().from("plan_slots").delete().eq("id", row.id));
  }

  async function split(day: string, slot: Slot) {
    const everyone = slots.filter((s) => s.day === day && s.slot === slot && s.member_id === null);
    const rows = members.map((m) => ({
      plan_id: id, day, slot, member_id: m.id,
      meal_id: rowsFor(m, slot, dayType(day), everyone)[0]?.meal_id ?? null, portions: 1, position: 0,
    }));
    const { data, error } = await supabase().from("plan_slots").insert(rows).select();
    if (error) return setError(error.message);
    setSlots((cur) => [...cur, ...((data as PlanSlot[]) ?? [])]);
  }

  async function join(day: string, slot: Slot) {
    const own = slots.filter((s) => s.day === day && s.slot === slot && s.member_id !== null);
    setSlots(slots.filter((s) => !own.includes(s)));
    run(supabase().from("plan_slots").delete().in("id", own.map((s) => s.id)));
  }

  function dayTotals(member: Member, day: string): Macros {
    const t = dayType(day);
    const rows = slots.filter((s) => s.day === day);
    return SLOTS.reduce((acc, slot) => rowsFor(member, slot, t, rows).reduce((a, row) => {
      const per = row.meal_id ? perServing.get(row.meal_id) : undefined;
      return per ? add(a, scale(per, member.portion_factor * row.portions)) : a;
    }, acc), ZERO);
  }

  if (loading || !plan) return <main className="page"><p className="muted">{error ?? "Loading…"}</p></main>;

  const weekStart = addDays(plan.start_date, week * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <main className="page">
      <Link href="/plans" className="small">← Plans</Link>
      <div className="row between">
        <h1>{plan.name}</h1>
      </div>
      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      <div className="weektabs">
        {Array.from({ length: plan.weeks }, (_, i) => (
          <button key={i} className="chip" aria-pressed={week === i} onClick={() => setWeek(i)}>
            Week {i + 1} · {fmtDate(addDays(plan.start_date, i * 7))}
          </button>
        ))}
      </div>

      {weekDays.map((day) => {
        const t = dayType(day);
        const dayRows = slots.filter((s) => s.day === day);
        return (
          <section key={day} className="card daycard">
            <div className="row between">
              <h2>{DAY_LONG[weekday(day)]} {fmtDate(day)}</h2>
              <select aria-label={`Day type for ${fmtDate(day)}`} value={t} onChange={(e) => setDayType(day, e.target.value as DayType)} style={{ width: "auto" }}>
                {DAY_TYPES.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
            </div>

            {SLOTS.map((slot) => {
              const rows = dayRows.filter((r) => r.slot === slot);
              const everyone = rows.filter((r) => r.member_id === null);
              const isSplit = rows.some((r) => r.member_id !== null);
              const skipped = members.filter((m) => t === "office" && m.skips_on_office_days.includes(slot)).map((m) => m.name);
              return (
                <div key={slot} className="slot">
                  <div className="row between">
                    <span className="label">{slotLabel(slot, t)}</span>
                    {isSplit
                      ? <button className="btn ghost sm" onClick={() => join(day, slot)}>Same for everyone</button>
                      : <button className="btn ghost sm" onClick={() => split(day, slot)}>Different per person</button>}
                  </div>

                  {!isSplit && (
                    <>
                      {everyone.map((row) => (
                        <div key={row.id} className="row" style={{ flexWrap: "nowrap" }}>
                          <MealSelect label={`${slotLabel(slot, t)} for everyone`} value={row.meal_id} slot={slot} meals={meals}
                            onChange={(v) => (v ? updateRow(row, { meal_id: v }) : removeRow(row))} />
                          <button className="btn ghost sm" aria-label="Remove" onClick={() => removeRow(row)}>✕</button>
                        </div>
                      ))}
                      {(everyone.length === 0 || slot === "snack") && (
                        <MealSelect label={`Add ${slotLabel(slot, t)}`} value={null} slot={slot} meals={meals}
                          onChange={(v) => v && addRow(day, slot, null, v)} />
                      )}
                      {skipped.length > 0 && <span className="muted small">{skipped.join(", ")}: fasting until after work</span>}
                    </>
                  )}

                  {isSplit && members.map((m) => {
                    const own = rows.filter((r) => r.member_id === m.id);
                    return (
                      <div key={m.id} className="stack" style={{ gap: 4 }}>
                        <span className="small"><b>{m.name}</b></span>
                        {own.map((row) => (
                          <div key={row.id} className="row" style={{ flexWrap: "nowrap" }}>
                            <MealSelect allowNone label={`${slotLabel(slot, t)} for ${m.name}`} value={row.meal_id} slot={slot} meals={meals}
                              onChange={(v) => updateRow(row, { meal_id: v })} />
                            {own.length > 1 && <button className="btn ghost sm" aria-label="Remove" onClick={() => removeRow(row)}>✕</button>}
                          </div>
                        ))}
                        {own.length === 0 && (
                          <MealSelect allowNone label={`${slotLabel(slot, t)} for ${m.name}`} value={null} slot={slot} meals={meals}
                            onChange={(v) => addRow(day, slot, m.id, v)} />
                        )}
                        {slot === "snack" && own.length > 0 && (
                          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => addRow(day, slot, m.id, null)}>+ another snack</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div className="totals">
              {members.map((m) => {
                const tot = dayTotals(m, day);
                const target = targetFor(m, t);
                const over = target.kcal != null && tot.kcal > target.kcal;
                return (
                  <div key={m.id} className={`total${over ? " over" : ""}`}>
                    <b>{m.name}</b>
                    <span className="num">{r(tot.kcal)}{target.kcal != null ? ` / ${target.kcal}` : ""} kcal</span>
                    {target.kcal != null && <div className="bar"><i style={{ width: `${Math.min(100, (tot.kcal / target.kcal) * 100)}%` }} /></div>}
                    <span className="num muted">P {r(tot.protein)}{target.protein != null ? `/${target.protein}` : ""} · C {r(tot.carbs)} · F {r(tot.fat)} g</span>
                    {over && <span className="small">Over by {r(tot.kcal - target.kcal!)} kcal</span>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {mealMap.size === 0 && <p className="notice">No meals in the library yet — run the seed script in Supabase.</p>}
    </main>
  );
}
