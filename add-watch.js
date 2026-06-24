#!/usr/bin/env node
/**
 * WatchAtlas — Add Watch Script
 * Usage: node scripts/add-watch.js <aliexpress-url>
 *
 * Fetches product data from the AliExpress Affiliate API,
 * pre-fills as many fields as possible, then opens an
 * interactive prompt for the fields the API can't give us
 * (case size, movement, water resistance, etc).
 *
 * Requires ALI_APP_KEY and ALI_APP_SECRET in your environment
 * or in a .env.local file at the project root.
 */

import crypto   from "crypto";
import fs       from "fs";
import path     from "path";
import readline from "readline";
import { fileURLToPath } from "url";

// ── Load .env.local if present ────────────────────────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dir, "../.env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
}

const APP_KEY     = process.env.ALI_APP_KEY;
const APP_SECRET  = process.env.ALI_APP_SECRET;
const TRACKING_ID = process.env.ALI_TRACKING_ID || "default";
const DB_PATH     = path.join(__dir, "../public/watches.json");
const GATEWAY     = "https://api-sg.aliexpress.com/sync";

// ── Helpers ───────────────────────────────────────────────────────────────────
function sign(params) {
  const str = Object.keys(params).sort().map(k => `${k}${params[k]}`).join("");
  return crypto.createHmac("sha256", APP_SECRET).update(str).digest("hex").toUpperCase();
}

function extractProductId(url) {
  // Handles formats like:
  // https://www.aliexpress.com/item/1005004687066821.html
  // https://a.aliexpress.com/_shortlink
  const m = url.match(/\/item\/(\d+)\.html/);
  return m ? m[1] : null;
}

async function fetchProductDetails(productId) {
  const base = {
    app_key:         APP_KEY,
    timestamp:       String(Date.now()),
    sign_method:     "hmac-sha256",
    method:          "aliexpress.affiliate.product.query",
    keywords:        productId,
    tracking_id:     TRACKING_ID,
    page_no:         "1",
    page_size:       "1",
    fields:          "product_id,product_title,product_main_image_url,target_sale_price,evaluate_rate,lastest_volume,promotion_link,first_level_category_name",
    target_currency: "USD",
    target_language: "EN",
  };
  base.sign = sign(base);
  const res  = await fetch(`${GATEWAY}?${new URLSearchParams(base)}`);
  const data = await res.json();
  const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];
  return products[0] || null;
}

async function fetchAffiliateLink(productId) {
  // Use the link generation endpoint to get a clean affiliate URL
  const base = {
    app_key:      APP_KEY,
    timestamp:    String(Date.now()),
    sign_method:  "hmac-sha256",
    method:       "aliexpress.affiliate.link.generate",
    promotion_link_type: "0",
    source_values: `https://www.aliexpress.com/item/${productId}.html`,
    tracking_id:  TRACKING_ID,
  };
  base.sign = sign(base);
  const res  = await fetch(`${GATEWAY}?${new URLSearchParams(base)}`);
  const data = await res.json();
  const links = data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link || [];
  return links[0]?.promotion_link || `https://www.aliexpress.com/item/${productId}.html`;
}

// ── Inference helpers (same as frontend) ─────────────────────────────────────
function inferColor(title) {
  const t = title.toLowerCase();
  const map = {
    black:["black","matte black","dlc"], blue:["blue","navy","cobalt","midnight"],
    green:["green","olive","forest","military"], white:["white","cream","ivory","polar"],
    silver:["silver dial"], orange:["orange","copper"], champagne:["champagne","gold dial","cognac"],
    red:["red","burgundy","cherry"], grey:["grey","gray","slate"],
  };
  for (const [c, kws] of Object.entries(map)) if (kws.some(k => t.includes(k))) return c;
  return "black";
}

function inferTypes(title) {
  const t = title.toLowerCase();
  const out = [];
  if (["diver","dive","200m","300m","submariner style","tuna"].some(k => t.includes(k))) out.push("diver");
  if (["dress","slim","formal"].some(k => t.includes(k))) out.push("dress");
  if (["field watch","military","pilot"].some(k => t.includes(k))) out.push("field");
  if (["gmt","dual time"].some(k => t.includes(k))) out.push("gmt");
  if (["chronograph","chrono"].some(k => t.includes(k))) out.push("chronograph");
  if (["submariner","datejust","daytona","seamaster","royal oak","black bay","bb58","snowflake","pelagos"].some(k => t.includes(k))) out.push("homage");
  return out.length ? out : ["original"];
}

function inferMovement(title) {
  const t = title.toLowerCase();
  if (t.includes("nh35")) return "NH35A";
  if (t.includes("nh34")) return "NH34";
  if (t.includes("nh38")) return "NH38";
  if (t.includes("miyota 9015") || t.includes("miyota9015")) return "Miyota 9015";
  if (t.includes("vk63") || t.includes("meca-quartz")) return "VK63";
  return null;
}

function inferSize(title) {
  const m = title.match(/\b(3[2-9]|4[0-9]|5[0-2])\s?mm\b/i);
  return m ? parseInt(m[1]) : null;
}

// ── Prompt helper ─────────────────────────────────────────────────────────────
function prompt(rl, question, defaultVal) {
  return new Promise(resolve => {
    const suffix = defaultVal !== undefined ? ` [${defaultVal}]` : "";
    rl.question(`  ${question}${suffix}: `, ans => {
      resolve(ans.trim() || (defaultVal !== undefined ? String(defaultVal) : ""));
    });
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("\nUsage: node scripts/add-watch.js <aliexpress-url>\n");
    process.exit(1);
  }
  if (!APP_KEY || !APP_SECRET) {
    console.error("\nError: ALI_APP_KEY and ALI_APP_SECRET must be set (in .env.local or environment).\n");
    process.exit(1);
  }

  const productId = extractProductId(url);
  if (!productId) {
    console.error("\nCould not extract a product ID from that URL. Make sure it contains /item/XXXXXXXXX.html\n");
    process.exit(1);
  }

  console.log(`\n🔍 Fetching product ${productId} from AliExpress API…\n`);

  let apiData = null;
  let affiliateUrl = url;

  try {
    [apiData, affiliateUrl] = await Promise.all([
      fetchProductDetails(productId),
      fetchAffiliateLink(productId),
    ]);
  } catch (e) {
    console.warn("  API fetch failed:", e.message, "— continuing with manual entry.\n");
  }

  const title     = apiData?.product_title || "";
  const image     = apiData?.product_main_image_url || "";
  const price     = parseFloat(apiData?.target_sale_price || "0");
  const rating    = parseFloat(apiData?.evaluate_rate || "0") / 20;
  const sold      = apiData?.lastest_volume || 0;

  // Pre-fill inferred values
  const inferredColor    = inferColor(title);
  const inferredTypes    = inferTypes(title);
  const inferredMovement = inferMovement(title);
  const inferredSize     = inferSize(title);

  console.log("📋 Pre-filled from API:");
  if (title) console.log(`   Title    : ${title}`);
  if (price)  console.log(`   Price    : $${price}`);
  if (image)  console.log(`   Image    : ${image.slice(0, 60)}…`);
  console.log(`   Color    : ${inferredColor}  (inferred)`);
  console.log(`   Types    : ${inferredTypes.join(", ")}  (inferred)`);
  if (inferredMovement) console.log(`   Movement : ${inferredMovement}  (inferred)`);
  if (inferredSize)     console.log(`   Size     : ${inferredSize}mm  (inferred)`);
  console.log("\n📝 Fill in the rest (press Enter to keep the suggested value):\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const brand       = await prompt(rl, "Brand (e.g. San Martin)");
  const model       = await prompt(rl, "Model ref (e.g. SN0116)");
  const name        = await prompt(rl, "Display name", title || `${brand} ${model}`);
  const dialColor   = await prompt(rl, "Dial color", inferredColor);
  const dialFinish  = await prompt(rl, "Dial finish (sunray/matte/textured/skeleton)", "sunray");
  const caseSize    = await prompt(rl, "Case diameter (mm)", inferredSize || "");
  const caseMat     = await prompt(rl, "Case material", "316L stainless steel");
  const wr          = await prompt(rl, "Water resistance (m)", "100");
  const movement    = await prompt(rl, "Movement", inferredMovement || "NH35A");
  const lug2lug     = await prompt(rl, "Lug-to-lug (mm)", "");
  const thickness   = await prompt(rl, "Thickness (mm)", "");
  const crystal     = await prompt(rl, "Crystal", "sapphire");
  const bracelet    = await prompt(rl, "Bracelet/strap", "oyster");
  const typesStr    = await prompt(rl, "Types (comma-separated: diver,homage,original,gmt,field,dress,chronograph)", inferredTypes.join(","));
  const inspiredBy  = await prompt(rl, "Inspired by (leave blank if original)", "");
  const finalPrice  = await prompt(rl, "Price (USD)", price || "");
  const finalImage  = await prompt(rl, "Image URL", image || "");
  const tagsStr     = await prompt(rl, "Tags (comma-separated)", "");

  rl.close();

  // Build the entry
  const id = slugify(`${brand}-${model}-${dialColor}`);
  const entry = {
    id,
    brand,
    model,
    name,
    dialColor,
    dialFinish,
    caseSize:        caseSize    ? parseInt(caseSize)    : null,
    caseMaterial:    caseMat,
    waterResistance: wr          ? parseInt(wr)          : null,
    movement,
    lug2lug:         lug2lug     ? parseInt(lug2lug)     : null,
    thickness:       thickness   ? parseFloat(thickness) : null,
    crystal,
    bracelet,
    type:            typesStr.split(",").map(s => s.trim()).filter(Boolean),
    inspiredBy:      inspiredBy  || null,
    price:           finalPrice  ? parseFloat(finalPrice) : null,
    image:           finalImage  || null,
    aliUrl:          affiliateUrl,
    rating:          rating      || null,
    sold:            sold        || 0,
    tags:            tagsStr.split(",").map(s => s.trim()).filter(Boolean),
  };

  // Load existing DB, append, write back
  let db = [];
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  }

  const existingIdx = db.findIndex(w => w.id === id);
  if (existingIdx >= 0) {
    const overwrite = await new Promise(resolve => {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl2.question(`\n⚠️  Entry with id "${id}" already exists. Overwrite? (y/N) `, ans => {
        rl2.close(); resolve(ans.trim().toLowerCase() === "y");
      });
    });
    if (!overwrite) { console.log("\nAborted.\n"); process.exit(0); }
    db[existingIdx] = entry;
    console.log(`\n✅ Updated "${name}" in watches.json\n`);
  } else {
    db.push(entry);
    console.log(`\n✅ Added "${name}" to watches.json (${db.length} total)\n`);
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  console.log("Entry written:");
  console.log(JSON.stringify(entry, null, 2));
  console.log("\nDeploy your project to publish the update.\n");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
