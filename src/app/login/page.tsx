"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: 48 }}>
      <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" width={72} height={72} style={{ borderRadius: 18 }} />
        <h1>EasyShop</h1>
        <p className="muted" style={{ margin: 0 }}>Meal plans, shopping list and the weekly shop.</p>
      </div>
      <form className="card" onSubmit={signIn}>
        <label className="field">
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        <button className="btn primary" disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
