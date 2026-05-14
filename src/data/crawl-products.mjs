#!/usr/bin/env node
// ============================================================================
// SIMRACEHUB · PRODUCT CRAWLER (v2)
// ============================================================================
//
// Was es macht
// ------------
// Liest die strukturierten Daten (OpenGraph, schema.org JSON-LD, Mikrodata)
// von Produkt-Seiten und schreibt sie in products-live.json.
// Diese Datei wird vom Frontend (SimRacing Affiliate.html) automatisch
// bevorzugt geladen — sie überschreibt einzelne Felder (Preis, Bild,
// Verfügbarkeit, Rating) der Produkte in products.js.
//
// Funktioniert auf
// ----------------
// ✅ Fanatec, MOZA Racing, Simucube, Heusinkveld, Trak Racer, Playseat
// ✅ Logitech G, MediaMarkt, Alternate, Caseking, Idealo, Geizhals
// ✅ Generell jeder moderne Shop (Shopify/WooCommerce/Magento/Custom)
//    der OpenGraph oder schema.org-Markup ausliefert
// ❌ Amazon.de — blockt User-Agents. Für Amazon: PA-API 5.0 nutzen
//    (siehe README.md → Abschnitt "Amazon")
//
// USAGE
// -----
//   node crawl-products.mjs sources.json                    → products-live.json
//   node crawl-products.mjs --url <URL>                     → einzelne URL testen
//   node crawl-products.mjs --diag <URL>                    → Diagnose, was extrahiert wird
// ============================================================================

import { readFile, writeFile } from "node:fs/promises";
import { argv, exit, stderr } from "node:process";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20000;
const DEFAULT_DELAY_MS = 1500;
const MAX_PARALLEL = 1; // 1 = höflich, pro Domain sowieso seriell

// ── HTML / Text helpers ────────────────────────────────────────────────────

function decode(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&euro;/g, "€").replace(/&nbsp;/g, " ").replace(/&deg;/g, "°")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function cleanPrice(s) {
  if (s == null || s === "") return null;
  if (typeof s === "number") return s;
  // "1.299,00 €" / "$ 999.00" / "EUR 449,95" / "479.95" → 479.95
  let str = String(s).replace(/[€$£]|EUR|USD|GBP|CHF/gi, "").trim();
  const hasComma = str.includes(",");
  const hasDot   = str.includes(".");
  if (hasComma && hasDot) {
    // Deutsche Notation 1.299,00 → 1299.00 ; US 1,299.00 → 1299.00
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    str = str.replace(",", ".");
  }
  const n = parseFloat(str);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function metaTag(html, name) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${name}["']`, "i");
  return decode(html.match(re1)?.[1] ?? html.match(re2)?.[1] ?? null);
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim()
      // Tolerant: bei einigen Shops sitzen Kommentare oder trailing semicolons drin
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\uFEFF/, "");
    try { out.push(JSON.parse(raw)); }
    catch {
      // Mehrere JSON-Blöcke aneinander? "}{" trennen
      try {
        const arr = JSON.parse("[" + raw.replace(/\}\s*\{/g, "},{") + "]");
        out.push(...arr);
      } catch { /* skip */ }
    }
  }
  return out;
}

function findProduct(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const x of node) { const p = findProduct(x); if (p) return p; }
    return null;
  }
  if (typeof node !== "object") return null;
  const t = node["@type"];
  const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
  if (isProduct) return node;
  if (node["@graph"]) return findProduct(node["@graph"]);
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") { const p = findProduct(v); if (p) return p; }
  }
  return null;
}

// ── HTML-Fallback price extractors (wenn weder OG noch JSON-LD existieren) ─

const HTML_PRICE_PATTERNS = [
  // Microdata-Properties: itemprop="price"
  /<(?:span|meta|div|p)[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
  /<(?:span|div|p)[^>]+itemprop=["']price["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i,
  // Häufige Klassen-Namen
  /<(?:span|div|p)[^>]+class=["'][^"']*(?:product-price|current-price|sale-price|price__current|price-actual|product__price)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i,
  // data-price="..."
  /\bdata-price=["']([0-9.,]+)["']/i,
];

function extractHtmlPrice(html) {
  for (const re of HTML_PRICE_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    // Inner-HTML stripp tags und nimm erstes Zahlen-Vorkommen
    const text = decode(m[1].replace(/<[^>]+>/g, " "));
    const num = text.match(/\d[\d.,]*/);
    if (num) {
      const p = cleanPrice(num[0]);
      if (p && p > 0.5 && p < 100000) return p;
    }
  }
  return null;
}

const HTML_IMAGE_PATTERNS = [
  /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  /<img[^>]+(?:class|id)=["'][^"']*(?:product-image|product__image|main-image|hero-image|gallery-image)[^"']*["'][^>]+src=["']([^"']+)["']/i,
];

function extractHtmlImage(html, baseUrl) {
  for (const re of HTML_IMAGE_PATTERNS) {
    const m = html.match(re);
    if (m) return absUrl(m[1], baseUrl);
  }
  return null;
}

function absUrl(u, base) {
  if (!u) return null;
  try { return new URL(u, base).href; } catch { return u; }
}

// ── Brand-spezifische Quirks ───────────────────────────────────────────────

const BRAND_HOOKS = {
  // Fanatec lädt seinen Preis manchmal nur per JS nach. Wir prüfen ob's im
  // og:price:amount steht (das tut es bei den meisten Produktseiten).
  "fanatec.com": (html, data) => {
    // Fanatec hat manchmal "data-product-price" Attribute
    const dp = html.match(/data-product-price=["']([0-9.,]+)["']/i);
    if (dp && !data.price) data.price = cleanPrice(dp[1]);
    return data;
  },
  // MOZA Shopify-Stores liefern price oft als <script>var product = {...}</script>
  "mozaracing.com": (html, data) => {
    const m = html.match(/"price"\s*:\s*(\d+)/);
    if (m && !data.price) {
      // Shopify-Preise sind in Cents
      data.price = +m[1] / 100;
    }
    return data;
  },
  // Logitech: Preise via JSON-LD, gut.
  // Simucube: WooCommerce — JSON-LD funktioniert.
};

// ── Per-URL crawl ──────────────────────────────────────────────────────────

async function crawl(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);

  let html, finalUrl = url;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    finalUrl = res.url;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // 1) OpenGraph
  const og = {
    title:       metaTag(html, "og:title"),
    image:       metaTag(html, "og:image:secure_url") || metaTag(html, "og:image"),
    description: metaTag(html, "og:description") || metaTag(html, "description"),
    price:       cleanPrice(metaTag(html, "product:price:amount") || metaTag(html, "og:price:amount")),
    currency:    metaTag(html, "product:price:currency") || metaTag(html, "og:price:currency"),
    availability: metaTag(html, "product:availability") || metaTag(html, "og:availability"),
  };

  // 2) schema.org Product (JSON-LD)
  const ld = jsonLd(html);
  let prod = null;
  for (const b of ld) { prod = findProduct(b); if (prod) break; }

  let ldPrice = null, ldCurrency = null, ldRating = null, ldReviews = null;
  let ldAvail = null, ldName = null, ldImage = null, ldBrand = null, ldDesc = null;
  if (prod) {
    const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
    if (offer) {
      ldPrice    = cleanPrice(offer.price ?? offer.lowPrice ?? offer.highPrice);
      ldCurrency = offer.priceCurrency || null;
      ldAvail    = (offer.availability || "").replace(/^https?:\/\/schema\.org\//, "") || null;
    }
    if (prod.aggregateRating) {
      ldRating  = +prod.aggregateRating.ratingValue || null;
      ldReviews = +prod.aggregateRating.reviewCount || +prod.aggregateRating.ratingCount || null;
    }
    ldName  = decode(prod.name);
    ldImage = absUrl(Array.isArray(prod.image) ? prod.image[0] : (prod.image?.url || prod.image), finalUrl);
    ldBrand = decode(prod.brand?.name || prod.brand || null);
    ldDesc  = decode(prod.description || null);
  }

  // 3) Microdata-Mikroformate (itemprop) als zweite Fallback-Ebene
  const microPrice = !og.price && !ldPrice ? extractHtmlPrice(html) : null;
  const microImage = !og.image && !ldImage ? extractHtmlImage(html, finalUrl) : null;

  // 4) Pure <title> als letzter Fallback für Name
  const titleTag = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null);

  let data = {
    sourceUrl:   url,
    finalUrl,
    title:       og.title || ldName || decode(titleTag),
    image:       og.image || ldImage || microImage,
    description: og.description || ldDesc,
    price:       og.price || ldPrice || microPrice,
    currency:    og.currency || ldCurrency,
    availability: ldAvail || og.availability,
    rating:      ldRating,
    reviews:     ldReviews,
    brand:       ldBrand,
    crawledAt:   new Date().toISOString().slice(0, 10),
  };

  // Brand-Hooks anwenden
  const host = new URL(finalUrl).hostname.replace(/^www\./, "");
  for (const domain in BRAND_HOOKS) {
    if (host.endsWith(domain)) data = BRAND_HOOKS[domain](html, data);
  }

  return data;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function logErr(...a) { stderr.write(a.join(" ") + "\n"); }

async function main() {
  const args = argv.slice(2);
  if (args.length === 0) {
    logErr(`
Usage:
  node crawl-products.mjs sources.json            # → products-live.json
  node crawl-products.mjs --url <URL>             # einzelne URL → stdout
  node crawl-products.mjs --diag <URL>            # zeigt was alles extrahiert wurde
`);
    exit(1);
  }

  if (args[0] === "--url" || args[0] === "--diag") {
    const data = await crawl(args[1]);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // sources.json
  const sourcesPath = args[0];
  const outPath = args[1] || "products-live.json";
  const sources = JSON.parse(await readFile(sourcesPath, "utf8"));

  logErr(`\n🏁  Crawling ${sources.length} Quellen...\n`);

  const results = {};
  let ok = 0, fail = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const tag = `[${String(i+1).padStart(2,"0")}/${sources.length}]`;
    if (!s.url) { logErr(`${tag} skip — kein url-Feld`); continue; }
    if (s.skipCrawl) { logErr(`${tag} ↷ skip — ${s.shopKey || s.url} (skipCrawl: ${s.note || "—"})`); continue; }
    try {
      const data = await crawl(s.url);
      const key = s.id != null ? `id:${s.id}` : (s.shopKey || s.url);
      results[key] = { ...s, ...data };
      const priceFmt = data.price ? `${data.price.toFixed(2)} ${data.currency || ""}` : "—";
      const imgFmt = data.image ? "✓ Bild" : "✗ Bild";
      logErr(`${tag} ✓ ${(data.title || "—").slice(0, 60)} — ${priceFmt}  ${imgFmt}`);
      ok++;
    } catch (e) {
      const key = s.id != null ? `id:${s.id}` : (s.shopKey || s.url);
      results[key] = { ...s, error: e.message, crawledAt: new Date().toISOString().slice(0, 10) };
      logErr(`${tag} ✗ ${s.url} — ${e.message}`);
      fail++;
    }
    if (i < sources.length - 1) await new Promise(r => setTimeout(r, s.delay || DEFAULT_DELAY_MS));
  }

  await writeFile(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    okCount: ok, failCount: fail,
    products: results,
  }, null, 2));

  logErr(`\n✅  Fertig: ${ok} ok, ${fail} Fehler  →  ${outPath}\n`);
}

main().catch(e => { logErr("Fatal:", e.stack || e.message); exit(1); });
