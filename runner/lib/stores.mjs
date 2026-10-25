// Store readers: search each supermarket in the runner's own browser and read the product cards.
// Selectors were taken from the live sites on 24 Oct 2026. If a store changes its website,
// the matching function here is the only thing that needs updating.

const pause = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * ms * 0.5));

// ---- functions that run inside the store's page -----------------------------------------

/** Sainsbury's: product cards carry data-testid="gw-…" labels. */
function readSainsburys() {
  const q = (c, t) => c.querySelector(`[data-testid="${t}"]`);
  const price = (s) => { const m = (s || "").match(/£\s*(\d+(?:\.\d{1,2})?)/); return m ? Number(m[1]) : null; };
  return [...document.querySelectorAll('[data-testid="gw-product-card"]')].map((c) => {
    const link = c.querySelector('a[href*="/product/"]');
    const text = c.innerText;
    // Most Sainsbury's offers are Nectar-only now; only offers without "Nectar" count for you.
    const offerLine = text.split("\n").map((t) => t.trim())
      .find((t) => /(\d+\s*for\s*£|\d+\s*for\s*\d+|buy 1 get 1|half price)/i.test(t) && !/nectar/i.test(t));
    return {
      name: q(c, "gw-product-name")?.innerText.trim() || link?.innerText.trim() || "",
      url: link ? new URL(link.getAttribute("href"), location.origin).href : null,
      price: price(q(c, "gw-product-retail-price")?.innerText),
      memberPrice: null, // Nectar prices are ignored: you don't use Nectar
      offer: offerLine || null,
      size: null,
      inStock: !/currently unavailable|out of stock/i.test(text) && !!q(c, "gw-add-to-basket"),
    };
  }).filter((p) => p.name);
}

/** Tesco: obfuscated class names, so the card is found from the product link and read as text. */
function readTesco() {
  const links = [...document.querySelectorAll('a[href*="/products/"]')];
  const cardOf = (a) => { let e = a; for (let i = 0; i < 10 && e; i++) { if (/£/.test(e.innerText || "") && e.querySelector("button")) return e; e = e.parentElement; } return null; };
  const seen = new Set();
  const out = [];
  for (const a of links) {
    const c = cardOf(a);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const lines = c.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    const nameLink = [...c.querySelectorAll('a[href*="/products/"]')].map((x) => x.innerText.trim()).sort((x, y) => y.length - x.length)[0];
    const cc = lines.find((l) => /^£\d+(\.\d{2})?(\s+Save.*)?\s+Clubcard Price$/i.test(l));
    const offer = lines.find((l) => /\bfor\b.*£|\d+\s+for\s+\d+|half price|buy 1 get 1/i.test(l) && !/^£/.test(l));
    const shelf = lines.find((l) => /^£\d+(\.\d{2})?$/.test(l));
    const num = (s) => { const m = (s || "").match(/£\s*(\d+(?:\.\d{1,2})?)/); return m ? Number(m[1]) : null; };
    out.push({
      name: nameLink || lines.find((l) => l.length > 6 && !/sponsored|new|more like this/i.test(l)) || "",
      url: a.href,
      price: num(shelf),
      memberPrice: cc ? num(cc) : null,
      offer: offer || null,
      size: null,
      inStock: !/unavailable|out of stock|sold out/i.test(c.innerText),
    });
  }
  return out.filter((p) => p.name);
}

/** Ocado and Morrisons share a platform: data-test="fop-…" labels. */
function readFop() {
  const g = (c, t) => c.querySelector(`[data-test="${t}"]`)?.innerText?.replace(/\s+/g, " ").trim() || null;
  const price = (s) => { const m = (s || "").match(/£\s*(\d+(?:\.\d{1,2})?)|(\d+)p\b/); return m ? (m[1] ? Number(m[1]) : Number(m[2]) / 100) : null; };
  return [...document.querySelectorAll('[data-test="fop-body"]')].map((b) => {
    const link = b.querySelector('a[data-test="fop-product-link"]') || b.closest("[data-test^='fop-wrapper']")?.querySelector('a[data-test="fop-product-link"]');
    return {
      name: g(b, "fop-title") || "",
      url: link ? new URL(link.getAttribute("href"), location.origin).href : null,
      price: price(g(b, "fop-price")),
      memberPrice: null,
      offer: g(b, "fop-offer-text"),
      size: g(b, "fop-size"),
      inStock: !!b.querySelector('[data-test="counter-button"]') && !/out of stock|unavailable/i.test(b.innerText),
    };
  }).filter((p) => p.name && p.url);
}

// ---- store definitions ----------------------------------------------------------------------

export const STORE_INFO = {
  tesco: { name: "Tesco", home: "https://www.tesco.com/groceries/en-GB", read: readTesco },
  sainsburys: { name: "Sainsbury's", home: "https://www.sainsburys.co.uk/gol-ui/groceries", read: readSainsburys,
    searchUrl: (q) => `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(q)}` },
  morrisons: { name: "Morrisons", home: "https://groceries.morrisons.com", read: readFop,
    searchUrl: (q) => `https://groceries.morrisons.com/search?q=${encodeURIComponent(q)}` },
  ocado: { name: "Ocado", home: "https://www.ocado.com", read: readFop,
    searchUrl: (q) => `https://www.ocado.com/search?q=${encodeURIComponent(q)}` },
};

async function waitForResults(page, store) {
  const sel = store === "sainsburys" ? '[data-testid="gw-product-card"]' : store === "tesco" ? 'a[href*="/products/"]' : '[data-test="fop-body"]';
  try {
    await page.waitForSelector(sel, { timeout: 15000 });
  } catch {
    return false;
  }
  // let prices render and lazy cards load
  await page.mouse.wheel(0, 1500).catch(() => {});
  await pause(1200);
  return true;
}

/** Close survey pop-ups and other dialogs that sit on top of the page (e.g. Tesco's "We would love to hear about your visit"). */
export async function dismissPopups(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("dialog[open]")) {
      const close = d.querySelector('button[aria-label*="lose" i], button[data-testid*="close" i], button[class*="close" i]');
      if (close) close.click();
      else try { d.close(); } catch { d.remove(); }
    }
    // generic overlay survey widgets
    for (const el of document.querySelectorAll('[id*="survey" i], [class*="survey-modal" i], [id^="QSIFeedback"], .fsrDialog, #fsrInvite')) el.remove();
  }).catch(() => {});
}

/** Tesco blocks search links opened directly, so search the way a person does: type into the box. */
async function tescoSearch(page, query) {
  let box = page.locator('input[type="search"]').first();
  if (!(await box.count())) {
    await page.goto(STORE_INFO.tesco.home, { waitUntil: "domcontentloaded" });
    await pause(1500);
    box = page.locator('input[type="search"]').first();
  }
  await dismissPopups(page);
  // fill + press on the box itself, so a pop-up covering it can't swallow the click
  await box.fill(query, { timeout: 15000 });
  await pause(300);
  await box.press("Enter");
  await page.waitForURL(/search\?query=/, { timeout: 15000 }).catch(() => {});
}

/** Search a store and return product cards. Throws a readable error when the site shows a security check. */
export async function search(page, store, query) {
  const info = STORE_INFO[store];
  if (store === "tesco") await tescoSearch(page, query);
  else await page.goto(info.searchUrl(query), { waitUntil: "domcontentloaded" });
  await dismissPopups(page);
  const ok = await waitForResults(page, store);
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000);
  if (/failed some security checks|access denied|verify you are human|captcha/i.test(body)) {
    const e = new Error(`${info.name} is asking for a security check — open the runner window and complete it, then try again.`);
    e.blocked = true;
    throw e;
  }
  if (!ok) return [];
  const items = await page.evaluate(info.read);
  await pause(800);
  return items.slice(0, 24);
}

// ---- basket fill -------------------------------------------------------------------------

/** Mark the product card whose link matches `url` (or, failing that, whose name matches) so it can be clicked.
 *  Links inside the store's basket / trolley panel are ignored — they have + buttons too. Runs in the page. */
function markCard([store, url, name]) {
  const path = (u) => { try { return new URL(u, location.origin).pathname.replace(/\/$/, ""); } catch { return u; } };
  const want = path(url);
  const inBasket = (el) => !!el.closest('aside, [role="dialog"], dialog, [class*="basket" i], [class*="trolley" i], [id*="basket" i], [id*="trolley" i], [data-testid*="basket" i], [data-testid*="trolley" i], [data-test*="basket" i], [data-test*="trolley" i], [aria-label*="basket" i], [aria-label*="trolley" i]');
  document.querySelectorAll("[data-easyshop-target]").forEach((e) => e.removeAttribute("data-easyshop-target"));
  const all = [...document.querySelectorAll("a[href]")].filter((a) => !inBasket(a));
  const byUrl = all.filter((a) => path(a.getAttribute("href")) === want);
  const clean = (t) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
  const byName = name ? all.filter((a) => clean(a.innerText) === clean(name)) : [];
  for (const a of [...byUrl, ...byName]) {
    let card = null;
    if (store === "sainsburys") card = a.closest('[data-testid="gw-product-card"]');
    else if (store === "morrisons" || store === "ocado") card = a.closest('[data-test^="fop-wrapper"]') || a.closest('[data-test="fop-body"]')?.parentElement;
    else { let e = a; for (let i = 0; i < 10 && e; i++) { if (/£/.test(e.innerText || "") && e.querySelector("button")) { card = e; break; } e = e.parentElement; } }
    if (card && !inBasket(card) && card.querySelector("button")) { card.setAttribute("data-easyshop-target", "1"); return true; }
  }
  return false;
}

/** True when the marked card already shows a quantity (no plain Add button). Runs in the page. */
function alreadyInTrolley() {
  const c = document.querySelector("[data-easyshop-target]");
  if (!c) return false;
  const buttons = [...c.querySelectorAll("button")];
  const hasAdd = buttons.some((b) => /^add$/i.test(b.innerText.trim()) || b.getAttribute("data-testid") === "gw-add-to-basket");
  const hasMinus = buttons.some((b) => /remove 1|decrease|^[−-]$/i.test(((b.getAttribute("aria-label") || "") + " " + b.innerText).trim()));
  return !hasAdd && hasMinus;
}

async function clickIn(page, selectors) {
  const card = page.locator("[data-easyshop-target]");
  for (const sel of selectors) {
    const b = card.locator(sel).first();
    if (await b.count()) {
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click({ timeout: 8000 });
      return true;
    }
  }
  return false;
}

const ADD = {
  sainsburys: ['[data-testid="gw-add-to-basket"]', 'button:has-text("Add")'],
  morrisons: ['button[data-test="counter-button"]', 'button:has-text("Add")'],
  ocado: ['button[data-test="counter-button"]', 'button:has-text("Add")'],
  tesco: ['button:has-text("Add")'],
};
const PLUS = {
  tesco: ['button[aria-label^="add 1" i]', 'button[aria-label*="increase" i]', 'button:has-text("+")'],
  other: ['button[aria-label*="ncrease" i]', 'button[aria-label*="one more" i]', 'button[aria-label*="add another" i]',
    'button[aria-label^="add 1" i]', 'button[data-testid*="increment" i]', 'button[data-test*="increment" i]', 'button:has-text("+")'],
};

/**
 * Put `qty` of the product at `url` into the store's trolley.
 * Clicks Add once and then + exactly (qty − 1) times — it never reads the quantity back to decide whether to
 * keep going, so it can't run away. If a click doesn't work it stops short and reports it.
 * Returns { got, status, note, html } — html is the card's markup when something didn't work, for fixing.
 */
export async function addToTrolley(page, store, productName, url, qty) {
  const want = Math.min(Math.max(1, qty), 12); // never more than 12 of one thing in one go
  await search(page, store, productName);
  await dismissPopups(page);
  const mark = () => page.evaluate(markCard, [store, url, productName]);
  if (!(await mark())) return { got: 0, status: "not_found", note: "Product not on the search page" };
  const html = async () => (await page.locator("[data-easyshop-target]").evaluate((e) => e.outerHTML).catch(() => "")).slice(0, 20000);

  if (await page.evaluate(alreadyInTrolley)) return { got: 0, status: "already", note: "Already in your trolley — check the quantity" };
  let added = false;
  try { added = await clickIn(page, ADD[store]); } catch { added = false; }
  if (!added) return { got: 0, status: "failed", note: "Couldn't press Add", html: await html() };
  await pause(2000);
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  if (/sign in to add|log in to add|enter your postcode|please sign in/i.test(body)) {
    return { got: 0, status: "signin", note: "Store asked you to sign in" };
  }
  let got = 1;
  while (got < want) {
    await dismissPopups(page);
    if (!(await mark())) break; // the card re-renders after each change, so find it again
    const plus = store === "tesco" ? PLUS.tesco : PLUS.other;
    let clicked = false;
    try { clicked = await clickIn(page, plus); } catch { clicked = false; }
    if (!clicked) break;
    got++;
    await pause(1600);
  }
  if (got < want) return { got, status: "partial", note: "Couldn't find the + button", html: await html() };
  return { got, status: qty > 12 ? "partial" : "added", note: qty > 12 ? "Capped at 12 — add the rest yourself" : null };
}
