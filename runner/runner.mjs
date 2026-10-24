// EasyShop shop runner — runs on the Windows laptop.
// Waits for jobs from the app (match products, check prices) and does them in its own Edge window,
// signed in to the supermarkets as you. Start it with: npm start  (or automatically at sign-in).

import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { STORES } from "./lib/parse.mjs";
import { STORE_INFO } from "./lib/stores.mjs";
import { runMatch, runPrice } from "./lib/jobs.mjs";

const POLL_MS = 20_000;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in runner/.env — see README.md.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

export const PROFILE_DIR = process.env.PROFILE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "EasyShopRunner", "profile");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let context = null;
const pages = {};

async function browser() {
  if (context) return context;
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: false,
    viewport: null,
    // look like an ordinary browser window, not an automated one
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--start-minimized", "--disable-blink-features=AutomationControlled"],
  });
  context.on("close", () => { context = null; for (const k of Object.keys(pages)) delete pages[k]; });
  return context;
}

async function storePages(stores) {
  const ctx = await browser();
  for (const s of stores) {
    if (!pages[s] || pages[s].isClosed()) {
      pages[s] = await ctx.newPage();
      await pages[s].goto(STORE_INFO[s].home, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  return pages;
}

async function heartbeat() {
  await db.from("settings").update({ runner_seen_at: new Date().toISOString() }).eq("id", 1);
}

async function claim() {
  const { data } = await db.from("runner_jobs").select("*").eq("status", "queued").order("created_at").limit(1);
  const job = data?.[0];
  if (!job) return null;
  const { data: got } = await db.from("runner_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), progress: "Starting…" })
    .eq("id", job.id).eq("status", "queued").select().single();
  return got ?? null;
}

async function run(job) {
  const stores = job.payload.stores ?? STORES;
  log(`job ${job.type} ${job.id}`);
  try {
    const p = await storePages(stores);
    const result = job.type === "match" ? await runMatch(db, p, job)
      : job.type === "price" ? await runPrice(db, p, job)
      : (() => { throw new Error("Basket fill arrives in the next update."); })();
    await db.from("runner_jobs").update({ status: "done", result, finished_at: new Date().toISOString(), progress: "Finished" }).eq("id", job.id);
    log("done", JSON.stringify(result).slice(0, 300));
  } catch (e) {
    log("failed", e.message);
    await db.from("runner_jobs").update({ status: "failed", error: e.message, finished_at: new Date().toISOString() }).eq("id", job.id);
  }
}

async function loop() {
  log(`EasyShop runner started · profile ${PROFILE_DIR}`);
  // jobs left "running" by a crash or shutdown go back in the queue
  await db.from("runner_jobs").update({ status: "queued", progress: "Restarted" }).eq("status", "running");
  for (;;) {
    try {
      await heartbeat();
      const job = await claim();
      if (job) { await run(job); continue; }
    } catch (e) {
      log("error", e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

process.on("SIGINT", async () => { await context?.close().catch(() => {}); process.exit(0); });
loop();
