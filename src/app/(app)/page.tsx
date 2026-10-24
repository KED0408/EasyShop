"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { addDays, fmtDate } from "@/lib/plan";
import type { Plan } from "@/lib/types";

export default function Home() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    const db = supabase();
    db.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    db.from("plans").select("*").order("start_date", { ascending: false }).limit(5)
      .then(({ data }) => setPlans((data as Plan[]) ?? []));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const current = plans?.find((p) => p.start_date <= today && addDays(p.start_date, p.weeks * 7) > today);

  async function signOut() {
    await supabase().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="page">
      <div className="row between">
        <h1>EasyShop</h1>
        <button className="btn ghost sm" onClick={signOut}>Sign out</button>
      </div>
      {email && <p className="muted small" style={{ margin: 0 }}>Signed in as {email}</p>}

      <section className="card">
        <h2>Meal plan</h2>
        {plans === null ? (
          <p className="muted">Loading…</p>
        ) : current ? (
          <>
            <p style={{ margin: 0 }}>
              <b>{current.name}</b> is running: {fmtDate(current.start_date)} to {fmtDate(addDays(current.start_date, current.weeks * 7 - 1))}.
            </p>
            <Link className="btn primary" href={`/plans/${current.id}`}>Open this plan</Link>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>No plan covers this week yet.</p>
            <Link className="btn primary" href="/plans">Start a 3-week plan</Link>
          </>
        )}
      </section>

      <section className="card">
        <h2>Coming next</h2>
        <ul className="list small">
          <li><b>Shopping list &amp; store cupboard</b> — weekly list from the plan, leftovers, Alexa import.</li>
          <li><b>Price check</b> — Tesco (Clubcard), Sainsbury&apos;s, Morrisons and Ocado, with a budget alert.</li>
          <li><b>Basket fill</b> — the cheapest store&apos;s trolley filled for you to book and pay.</li>
        </ul>
      </section>
    </main>
  );
}
