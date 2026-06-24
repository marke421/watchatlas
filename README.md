# WatchAtlas 🕐

Chinese microbrand watch finder with AliExpress affiliate integration.

## Stack

- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Backend**: Vercel Serverless Function (Node.js 20)
- **API**: AliExpress Affiliate Portals API (`aliexpress.affiliate.product.query`)

---

## Setup in 5 minutes

### 1. Install Vercel CLI

```bash
npm install -g vercel
```

### 2. Clone / init project

```bash
cd watchatlas
npm install
```

### 3. Set environment variables

In the [Vercel dashboard](https://vercel.com) → your project → Settings → Environment Variables, add:

| Variable          | Where to find it                                              |
|-------------------|---------------------------------------------------------------|
| `ALI_APP_KEY`     | AliExpress Open Platform → My Apps → App Key                  |
| `ALI_APP_SECRET`  | AliExpress Open Platform → My Apps → App Secret               |
| `ALI_TRACKING_ID` | Portals affiliate dashboard → Tracking IDs (use `default` if unsure) |

For local dev, create a `.env.local` file (never commit this):

```
ALI_APP_KEY=123456789
ALI_APP_SECRET=your_secret_here
ALI_TRACKING_ID=default
```

### 4. Run locally

```bash
vercel dev
```

Open http://localhost:3000

### 5. Deploy

```bash
vercel --prod
```

---

## How it works

```
Browser                    Vercel Edge              AliExpress API
  │                            │                         │
  │  GET /api/search?q=...     │                         │
  │ ─────────────────────────► │                         │
  │                            │  Signs request with     │
  │                            │  HMAC-SHA256 + secret   │
  │                            │ ──────────────────────► │
  │                            │                         │
  │                            │ ◄────────────────────── │
  │  JSON (normalised)         │  Raw product list       │
  │ ◄───────────────────────── │                         │
  │                            │                         │
  │  Client-side enrichment:   │
  │  • Infer dial color from title
  │  • Infer case size (regex)
  │  • Infer movement (keyword)
  │  • Infer type (homage vs original)
  │
  │  Client-side filtering applied on enriched data
```

**Affiliate links** are returned directly by AliExpress inside `promotion_link`. Your tracking ID is embedded automatically — you don't need to wrap URLs manually.

---

## Customising the watch catalog

The API returns whatever AliExpress has. To control quality:

1. **Brand pills** (sidebar): Edit the `data-q` attributes in `index.html` to change search queries per brand.
2. **Category ID**: `200000783` is AliExpress's Watches category. You can narrow to sub-categories.
3. **Manual curation** (future): Add a `curated.json` with hand-picked product IDs to always show at the top.

---

## Keyword enrichment accuracy

Since AliExpress doesn't return structured specs, we infer them from titles:

| Field      | Accuracy | Notes                                      |
|------------|----------|--------------------------------------------|
| Dial color | ~75%     | Good for common colors, misses sunburst    |
| Case size  | ~80%     | Regex on "40mm" patterns                   |
| Movement   | ~85%     | NH35/Miyota are commonly mentioned         |
| Type       | ~70%     | Homage detection via reference model names |

To improve accuracy, you can add a manual override JSON in the future.

---

## File structure

```
watchatlas/
├── api/
│   └── search.js       ← Serverless proxy (keeps secret safe)
├── public/
│   └── index.html      ← Full frontend (single file)
├── vercel.json         ← Routing config
├── package.json
└── README.md
```

---

## Next steps

- [ ] Add a `curated.json` for hand-picked hero watches
- [ ] Cache API responses in Vercel KV to reduce API calls
- [ ] Add watch detail modal / page
- [ ] Submit sitemap for SEO
- [ ] Add price drop alerts (email)
