// One-off: opens the runner's own Edge window at each supermarket so you can sign in.
// Your sign-ins are saved in the runner's profile on this laptop only. Close the window when done.

import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PROFILE_DIR = process.env.PROFILE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "EasyShopRunner", "profile");
const SIGN_IN = [
  "https://www.tesco.com/groceries/en-GB",
  "https://www.sainsburys.co.uk/gol-ui/groceries",
  "https://groceries.morrisons.com",
  "https://www.ocado.com",
];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: false,
  viewport: null,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
});
const first = ctx.pages()[0] ?? (await ctx.newPage());
await first.goto(SIGN_IN[0]).catch(() => {});
for (const u of SIGN_IN.slice(1)) {
  const p = await ctx.newPage();
  await p.goto(u).catch(() => {});
}
console.log(`
EasyShop runner sign-in
-----------------------
A window has opened with a tab for each supermarket.
1. On each tab, click Sign in / Log in and sign in (tick "keep me signed in" / "remember me" where offered).
2. Accept or decline cookies as you prefer.
3. Close the whole window when you have finished — your sign-ins are saved.
Profile: ${PROFILE_DIR}
`);
await new Promise((resolve) => ctx.on("close", resolve));
console.log("Saved. You can now run:  npm start");
