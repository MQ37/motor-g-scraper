# motor-g-scraper

Apify Actor that scrapes brushless drone motor products from [motor-g.com](https://motor-g.com) — a Ukrainian manufacturer with configurable KV variants.

## What it scrapes

Extracts structured product data from the Shopify-powered storefront: product title, vendor, type, tags, price per KV variant, technical specifications (topology, magnets, winding, dimensions), KV variant options with availability, product images, and SKU codes.

## Quick start

```bash
pnpm install
pnpm start       # run with tsx
```

## Input

```json
{
  "startUrls": [
    { "url": "https://motor-g.com/en/collections/all" }
  ],
  "maxProducts": 50
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `startUrls` | array | — | Collection URLs to crawl |
| `maxProducts` | number | `50` | Max products to extract |

## Output schema

```json
{
  "productId": "string",
  "title": "string",
  "handle": "string",
  "url": "string",
  "vendor": "string",
  "type": "string",
  "tags": ["string"],
  "price": "number (UAH)",
  "currency": "string (UAH)",
  "description": "string",
  "specs": {
    "topology": "string | undefined",
    "magnets": "string | undefined",
    "heatResistantWinding": "string | undefined",
    "possibleKV": ["string"] | undefined,
    "sku": "string | undefined",
    "productionStage": "string | undefined",
    "dimensions": "string | undefined"
  },
  "variants": [
    {
      "kv": "string",
      "price": "number (UAH)",
      "currency": "string (UAH)",
      "available": "boolean"
    }
  ],
  "images": ["string (URL)"],
  "scrapedAt": "ISO 8601 date"
}
```

## Site structure

motor-g.com runs on Shopify with server-rendered collection and product pages. Product data is also exposed via the Shopify JSON API (`/products/{handle}.js`). Product discovery uses `ShopifyAnalytics.meta` on collection pages.

## Tech stack

- **Crawlee** — CheerioCrawler
- **Cheerio** — HTML parsing
- **Shopify JSON API** — supplemental product data
- **Apify SDK** — Actor lifecycle + dataset storage
- Node.js 22+
