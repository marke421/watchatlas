/**
 * WatchAtlas — AliExpress Affiliate API Proxy
 * Vercel Serverless Function (api/search.js)
 *
 * Keeps APP_SECRET server-side. The browser never sees it.
 *
 * Endpoint: GET /api/search?q=san+martin&page=1&pageSize=20
 */

import crypto from "crypto";

const APP_KEY    = process.env.ALI_APP_KEY;
const APP_SECRET = process.env.ALI_APP_SECRET;
const TRACKING_ID = process.env.ALI_TRACKING_ID || "default";

const ALI_GATEWAY = "https://api-sg.aliexpress.com/sync";

// ── Signature (AliExpress "top" signing algo) ──────────────────────────────
function sign(params) {
  // 1. Sort keys alphabetically
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join("");
  // 2. Wrap with secret and HMAC-SHA256
  return crypto
    .createHmac("sha256", APP_SECRET)
    .update(sorted)
    .digest("hex")
    .toUpperCase();
}

// ── Build canonical params ─────────────────────────────────────────────────
function buildParams(query, page, pageSize) {
  const now = Date.now();
  const base = {
    app_key:        APP_KEY,
    timestamp:      String(now),
    sign_method:    "hmac-sha256",
    method:         "aliexpress.affiliate.product.query",
    // API-level params
    keywords:       query,
    tracking_id:    TRACKING_ID,
    page_no:        String(page),
    page_size:      String(pageSize),
    // Return fields we actually need
    fields:         "product_id,product_title,product_main_image_url,target_sale_price,target_sale_price_currency,target_original_price,evaluate_rate,lastest_volume,promotion_link,first_level_category_name",
    category_ids:   "200000783", // Watches category on AliExpress
    sort:           "SALE_PRICE_ASC",
    target_currency: "USD",
    target_language: "EN",
    ship_to_country: "US",
  };
  base.sign = sign(base);
  return base;
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — allow your frontend domain (update in production)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!APP_KEY || !APP_SECRET) {
    return res.status(500).json({ error: "API credentials not configured. Set ALI_APP_KEY and ALI_APP_SECRET in Vercel env vars." });
  }

  const q        = (req.query.q        || "chinese microbrands watch").trim();
  const page     = Math.max(1, parseInt(req.query.page     || "1",  10));
  const pageSize = Math.min(50, parseInt(req.query.pageSize || "20", 10));

  const params = buildParams(q, page, pageSize);
  const url    = ALI_GATEWAY + "?" + new URLSearchParams(params).toString();

  try {
    const upstream = await fetch(url, {
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    });

    const raw = await upstream.json();

    // Navigate AliExpress response envelope
    const resp = raw?.aliexpress_affiliate_product_query_response?.resp_result;

    if (!resp || resp.resp_code !== 200) {
      console.error("AliExpress error:", JSON.stringify(raw));
      return res.status(502).json({
        error: "AliExpress API error",
        code:  resp?.resp_code,
        msg:   resp?.resp_msg,
      });
    }

    const products = resp.result?.products?.product || [];
    const totalCount = resp.result?.total_record_count || 0;

    // Normalise to WatchAtlas schema
    const watches = products.map(p => ({
      id:            p.product_id,
      name:          p.product_title,
      image:         p.product_main_image_url,
      price:         parseFloat(p.target_sale_price),
      currency:      p.target_sale_price_currency || "USD",
      originalPrice: parseFloat(p.target_original_price),
      rating:        parseFloat(p.evaluate_rate || "0") / 20, // 0-100 → 0-5
      sold:          p.lastest_volume || 0,
      affiliateUrl:  p.promotion_link,
      category:      p.first_level_category_name,
    }));

    return res.status(200).json({
      watches,
      total:    totalCount,
      page,
      pageSize,
      query:    q,
    });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy request failed", detail: err.message });
  }
}
