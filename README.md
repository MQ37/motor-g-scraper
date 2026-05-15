# Motor-G Scraper

Apify Actor that scrapes UAV drone motor products from [motor-g.com](https://motor-g.com) — a Ukrainian manufacturer of brushless drone motors with configurable KV variants.

## What it scrapes

Extracts structured product data from the Shopify-powered storefront:
- Product title, vendor, type, tags
- Price (UAH) per KV variant
- Technical specifications (topology, magnets, heat-resistant winding, dimensions)
- KV variant options with availability
- Product images (full resolution)
- SKU codes

## Stack

- **Crawlee** + CheerioCrawler
- **Cheerio** — HTML parsing
- **Shopify JSON API** (`/products/{handle}.js`) for base product data
- **ShopifyAnalytics.meta** for collection-level product discovery
- Node.js 22+

## Usage

```bash
pnpm install
pnpm start
```

Output is stored in `storage/datasets/default/` as JSON files.

## Input

```json
{
  "startUrls": [
    { "url": "https://motor-g.com/en/collections/all" }
  ],
  "maxProducts": 50
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `startUrls` | array | All products collection | Collection URLs to crawl |
| `maxProducts` | integer | 50 | Max products to scrape |

## Output shape

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

## Scraping target

| Detail | Value |
|---|---|
| Site | https://motor-g.com |
| Collection | `/en/collections/all` |
| Products | ~50 (configurable) |
| Tech | Shopify (server-rendered + JSON API) |
