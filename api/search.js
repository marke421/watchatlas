/**
 * WatchAtlas — AliExpress Affiliate API Proxy
 * Vercel Serverless Function (api/search.js)
 */

import crypto from "crypto";

const APP_KEY     = process.env.ALI_APP_KEY;
const APP_SECRET  = process.env.ALI_APP_SECRET;
const TRACKING_ID = process.env.ALI_TRACKING_ID || "default";

const ALI_GATEWAY = "https://api-sg.aliexpress.com/sync";

// ── Signature: sort params (WITHOUT sign key), concat, HMAC-SHA256 ──────────
function sign(params) {
  const str = Object.keys(params)
    .sort()
    .map(k => `${k}${params[k]}`)
    .join("");
  return crypto
    .createHmac("sha256", APP_SECRET)
    .update(str)
    .digest("hex")
    .toUpperCase();
}

// ── Build params — sign is added AFTER, not included in the hash input ───────
function buildParams(query, page, pageSize, sort) {
  const base = {
    app_key:         APP_KEY,
    timestamp:       String(Date.now()),
    sign_method:     "hmac-sha256",
    method:          "aliexpress.affiliate.product.query",
    keywords:        query,
    tracking_id:     TRACKING_ID,
    page_no:         String(page),
    page_size:       String(pageSize),
    fields:          "product_id,product_title,product_main_image_url,target_sale_price,target_sale_price_currency,target_original_price,evaluate_rate,lastest_volume,promotion_link,first_level_category_name",
    sort:            sort || "SALE_PRICE_ASC",
    target_currency: "USD",
    target_language: "EN",
    ship_to_country: "US",
  };
  // sign is computed on base (without sign itself), then appended
  base.sign = sign(base);
  return base;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Credential check ──
  if (!APP_KEY || !APP_SECRET) {
    return res.status(500).json({
      error: "Missing credentials",
      detail: "Set ALI_APP_KEY and ALI_APP_SECRET in Vercel → Settings → Environment Variables, then redeploy.",
    });
  }

  const q        = (req.query.q        || "chinese microbrand watch").trim();
  const page     = Math.max(1,  parseInt(req.query.page     || "1",  10));
  const pageSize = Math.min(50, parseInt(req.query.pageSize || "20", 10));
  const sort     = req.query.sort || "SALE_PRICE_ASC";

  const params = buildParams(q, page, pageSize, sort);
  const url    = `${ALI_GATEWAY}?${new URLSearchParams(params)}`;

  let raw;
  try {
    const upstream = await fetch(url);
    raw = await upstream.json();
  } catch (err) {
    console.error("[WatchAtlas] fetch failed:", err);
    return res.status(500).json({ error: "Network error reaching AliExpress", detail: err.message });
  }

  // ── Log full response to Vercel logs so you can inspect it ──
  console.log("[WatchAtlas] AliExpress raw response:", JSON.stringify(raw));

  // ── Navigate envelope ──
  const resp = raw?.aliexpress_affiliate_product_query_response?.resp_result;

  if (!resp) {
    // Unexpected shape — return full raw so we can debug
    return res.status(502).json({
      error: "Unexpected response shape from AliExpress",
      raw,   // ← visible in browser for debugging
    });
  }

  if (resp.resp_code !== 200) {
    return res.status(502).json({
      error:   "AliExpress returned an error",
      code:    resp.resp_code,
      msg:     resp.resp_msg,
      // Common codes:
      // 27   = invalid sign
      // 15   = app not authorized for this API
      // 40   = invalid app_key
      // 400  = bad parameters
      hint: resp.resp_code === 27  ? "Signature mismatch — double-check APP_SECRET has no extra spaces."
          : resp.resp_code === 15  ? "Your app doesn't have the Affiliate API enabled. Go to open.aliexpress.com → your app → API Products and subscribe to 'Affiliate'."
          : resp.resp_code === 40  ? "Invalid APP_KEY. Verify the value in Vercel env vars."
          : resp.resp_code === 400 ? "Bad request parameters."
          : "Check Vercel logs for the full raw response.",
    });
  }

  const products   = resp.result?.products?.product || [];
  const totalCount = resp.result?.total_record_count || 0;

  const watches = products.map(p => ({
    id:            p.product_id,
    name:          p.product_title,
    image:         p.product_main_image_url,
    price:         parseFloat(p.target_sale_price   || "0"),
    currency:      p.target_sale_price_currency || "USD",
    originalPrice: parseFloat(p.target_original_price || "0"),
    rating:        parseFloat(p.evaluate_rate || "0") / 20, // 0–100 → 0–5
    sold:          p.lastest_volume || 0,
    affiliateUrl:  p.promotion_link,
    category:      p.first_level_category_name,
  }));

  return res.status(200).json({ watches, total: totalCount, page, pageSize, query: q });
}