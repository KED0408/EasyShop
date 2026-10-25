// EasyShop shop runner — runs on the Windows laptop.
// Waits for jobs from the app (match products, check prices) and does them in its own Edge window,
// signed in to the supermarkets as you. Start it with: npm start  (or automatically at sign-in).

import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { STORE_INFO, addToTrolley } from "./lib/stores.mjs";
import { runFill, runMatch, runPrice } from "./lib/jobs.mjs";

const VERSION = "1.3 (basket fix, 25 Oct)";
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

async function browser() {
  if (context) return context;
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: false,
    viewport: { width: 1200, height: 800 },
    // look like an ordinary browser window, not an automated one
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--window-size=1220,900", "--disable-blink-features=AutomationControlled"],
  });
  // Keep the laptop light: skip pictures, videos and web fonts — prices and names are all text.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue();
  });
  context.on("close", () => { context = null; });
  return context;
}

/** One tab per store, opened when that store's turn comes and closed straight after. */
const pages = {
  open: async (store) => {
    const ctx = await browser();
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(STORE_INFO[store].home, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    return page;
  },
  close: async () => {
    // keep the single tab for the next store; just clear it
    const page = context?.pages()[0];
    await page?.goto("about:blank").catch(() => {});
  },
};

const DEBUG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "debug");
/** Keep a copy of a product card the runner couldn't handle, so it can be fixed. */
async function saveDebug(name, html) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `${name}.html`), html);
  } catch {}
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
  log(`job ${job.type} ${job.id}`);
  try {
    const result = job.type === "match" ? await runMatch(db, pages, job)
      : job.type === "price" ? await runPrice(db, pages, job)
      : job.type === "fill" ? await runFill(db, pages, job, { addToTrolley, saveDebug })
      : (() => { throw new Error(`Unknown job type ${job.type}`); })();
    await db.from("runner_jobs").update({ status: "done", result, finished_at: new Date().toISOString(), progress: "Finished" }).eq("id", job.id);
    log("done", JSON.stringify(result).slice(0, 300));
    // close the window between jobs so nothing is left running in the background
    await context?.close().catch(() => {});
  } catch (e) {
    log("failed", e.message);
    await db.from("runner_jobs").update({ status: "failed", error: e.message, finished_at: new Date().toISOString() }).eq("id", job.id);
    await context?.close().catch(() => {});
  }
}

async function loop() {
  log(`EasyShop runner version ${VERSION} started · profile ${PROFILE_DIR}`);
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
