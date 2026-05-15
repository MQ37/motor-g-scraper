import { Actor } from 'apify';
import { CheerioCrawler, log, LogLevel } from 'crawlee';
import * as cheerio from 'cheerio';

// --- Types ---

interface ProductVariant {
  kv: string;
  price: number;
  currency: string;
  available: boolean;
}

interface ProductSpecs {
  topology?: string;
  magnets?: string;
  heatResistantWinding?: string;
  possibleKV?: string[];
  sku?: string;
  productionStage?: string;
  dimensions?: string;
}

interface Product {
  productId: string;
  title: string;
  handle: string;
  url: string;
  vendor: string;
  type: string;
  tags: string[];
  price: number;
  currency: string;
  description: string;
  specs: ProductSpecs;
  variants: ProductVariant[];
  images: string[];
  scrapedAt: string;
}

// --- Helpers ---

function extractShopifyMeta(html: string): ProductVariant[] | null {
  const match = html.match(/window\.ShopifyAnalytics\s*=\s*window\.ShopifyAnalytics\s*\|\|\s*\{\};?\s*window\.ShopifyAnalytics\.meta\s*=\s*window\.ShopifyAnalytics\.meta\s*\|\|\s*\{\};?\s*window\.ShopifyAnalytics\.meta\.currency\s*=\s*'(\w+)';\s*var meta\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[2]);
    return meta.products?.map((p: { handle: string; url?: string; variants: { title: string; price: number; available: boolean }[] }) => ({
      handle: p.handle,
      url: p.url || `/en/products/${p.handle}`,
      variants: p.variants.map((v: { title: string; price: number; available: boolean }) => ({
        kv: v.title,
        price: v.price / 100,
        available: v.available,
      })),
    })) || null;
  } catch {
    return null;
  }
}

function extractProductHandles(html: string): { handle: string; url: string; title: string }[] {
  // Try ShopifyAnalytics meta first
  const metaMatch = html.match(/var meta\s*=\s*(\{[\s\S]*?"products"[\s\S]*?\});/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      return meta.products?.map((p: { handle: string; title: string }) => ({
        handle: p.handle,
        url: `https://motor-g.com/en/products/${p.handle}`,
        title: p.title,
      })) || [];
    } catch { /* fall through */ }
  }

  // Fallback: extract from DOM links
  const $ = cheerio.load(html);
  const products: { handle: string; url: string; title: string }[] = [];
  $('a[href*="/products/"]').each((_, el) => {
    const href = $(el).attr('href');
    const title = $(el).find('h5').text().trim() || $(el).text().trim();
    if (href && href.includes('/products/') && !href.includes('/collections/')) {
      const handle = href.split('/products/')[1]?.split('?')[0];
      if (handle && !products.find(p => p.handle === handle)) {
        products.push({ handle, url: `https://motor-g.com${href}`, title });
      }
    }
  });
  return products;
}

function parseProductPage(html: string, url: string): Partial<Product> {
  const $ = cheerio.load(html);

  // Primary: extract structured data from JSON-LD
  const jsonLdScript = $('script[type="application/ld+json"]').html();
  let jsonLd: Record<string, unknown> | null = null;
  if (jsonLdScript) {
    try {
      jsonLd = JSON.parse(jsonLdScript);
    } catch { /* ignore */ }
  }

  // Parse description - prefer meta description (has tech specs), fall back to JSON-LD
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const ldDesc = (jsonLd?.description as string) || '';
  // Use meta description if it contains spec data, otherwise JSON-LD
  const description = (metaDesc && /[Тт]ополог|[Tt]opolog|[Мм]агн|[Mm]agnet|[Kk][Vv]|12N14P/.test(metaDesc))
    ? metaDesc
    : (ldDesc || metaDesc);

  // Extract specs from description text (both meta and JSON-LD have them)
  const specs: ProductSpecs = {};
  const descText = description.replace(/\n/g, ' ');

  // Topology - skip if value looks like another spec label
  const topoMatch = descText.match(/(?:Топологія|Topology)[:\s]+(\S+)/i);
  if (topoMatch && !/[Мм]агн|[Mm]agnet|[Жж]арост|[Hh]eat/.test(topoMatch[1])) {
    specs.topology = topoMatch[1];
  }

  // Magnets - capture until next spec label
  const magnetMatch = descText.match(/(?:Магніти|Magnets?)[:\s]+(.+?)(?:\s+(?:Жарост|Heat|$))/i);
  if (magnetMatch) {
    const val = magnetMatch[1].trim();
    if (val && !/жарост|heat|топол|topol/i.test(val)) {
      specs.magnets = val;
    }
  }

  // Heat-resistant winding
  const windingMatch = descText.match(/(?:Жаростійка\s+обмот(?:ка|ки)|Heat[- ]resistant\s+winding)[:\s]+(.+?)(?:\s|$)/i);
  if (windingMatch) {
    const val = windingMatch[1].trim();
    if (val && !/[Мм]агн|[Mm]agnet/.test(val)) {
      specs.heatResistantWinding = val;
    }
  }

  // Possible KV - capture until next spec label or end
  const kvMatch = descText.match(/(?:Можливі\s+(?:КВ|KV)|Possible\s+KV)[:\s]+(.+?)(?:\s+(?:Тополог|Topolog|Магніт|Magnet|Жарост|Heat|Стадія|$))/i);
  if (kvMatch) {
    const kvList = kvMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    if (kvList.length > 0) specs.possibleKV = kvList;
  }

  // Also try to extract from structured DOM (some products have richer data there)
  $('[class*="flex"][class*="items-center"]').each((_, el) => {
    const paragraphs = $(el).find('p');
    if (paragraphs.length >= 2) {
      const label = $(paragraphs[0]).text().trim().replace(/:$/, '');
      const value = $(paragraphs[1]).text().trim();
      if (!label || !value || value === ':') return;

      if (/тополог|topolog/i.test(label) && !specs.topology) {
        specs.topology = value;
      } else if (/магн|magnet/i.test(label) && !specs.magnets) {
        specs.magnets = value;
      } else if (/жарост|обмот|heat|winding/i.test(label) && !specs.heatResistantWinding) {
        specs.heatResistantWinding = value;
      } else if (/стад|production|stage/i.test(label)) {
        specs.productionStage = value;
      } else if (/розмір|size|діам/i.test(label)) {
        specs.dimensions = value;
      }
    }
  });

  // Extract SKU
  const skuMatch = $('body').text().match(/SKU[:\s]+(\S+)/);
  if (skuMatch && skuMatch[1].length > 1 && !/можлив/i.test(skuMatch[1])) {
    specs.sku = skuMatch[1];
  }

  // Extract variants from JSON-LD if available
  const variants: ProductVariant[] = [];
  const otherKvPatterns = /(?:[Іі]нш[еі]|[Oo]ther)/;
  const jsonLdVariants = jsonLd?.hasVariant as Array<{ name?: string; offers?: { price?: string; availability?: string } }> | undefined;
  if (jsonLdVariants) {
    for (const v of jsonLdVariants) {
      const name = v.name || '';
      const kvMatch = name.match(/-\s*(.+)$/);
      const kv = kvMatch ? kvMatch[1].trim() : name;
      if (otherKvPatterns.test(kv)) continue;
      variants.push({
        kv,
        price: v.offers?.price ? parseFloat(v.offers.price) : 0,
        currency: 'UAH',
        available: v.offers?.availability?.includes('InStock') ?? true,
      });
    }
    // Add custom KV option
    if (variants.length > 0) {
      variants.push({ kv: 'Custom/Other KV', price: variants[0].price, currency: 'UAH', available: true });
    }
  }

  // Fallback: extract price from DOM
  let price = variants[0]?.price || 0;
  if (!price) {
    const priceEl = $('[class*="price"]').first().text().trim();
    const priceMatch = priceEl.match(/([\d\s,.]+)\s*₴/);
    if (priceMatch) {
      price = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', ''));
    }
  }

  return {
    description,
    specs,
    variants,
  };
}

const UK_TO_EN_TITLE: Record<string, string> = {
  'Мотор': 'Motor',
  'мотор': 'motor',
};

function normalizeTitle(title: string): string {
  // Replace known Ukrainian words with English equivalents
  let result = title;
  for (const [uk, en] of Object.entries(UK_TO_EN_TITLE)) {
    result = result.replace(new RegExp(uk, 'g'), en);
  }
  return result.trim();
}

function transliterate(c: string): string {
  const map: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e',
    'є': 'ie', 'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i',
    'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ь': '', 'ю': 'iu', 'я': 'ia',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'H', 'Ґ': 'G', 'Д': 'D',
    'Е': 'E', 'Є': 'Ie', 'Ж': 'Zh', 'З': 'Z', 'И': 'Y', 'І': 'I',
    'Ї': 'I', 'Й': 'I', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N',
    'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ь': '', 'Ю': 'Iu', 'Я': 'Ia',
  };
  return map[c] || c;
}

// --- Main crawler ---

// --- Actor entrypoint ---

interface ActorInput {
  startUrls?: { url: string }[];
  maxProducts?: number;
}

async function main() {
  log.setLevel(LogLevel.INFO);

  // Initialize Apify Actor
  await Actor.init();

  // Read Actor input
  const input = await Actor.getInput<ActorInput>() ?? {};
  const startUrls = input.startUrls?.map(u => u.url) ?? ['https://motor-g.com/en/collections/all'];
  const maxProducts = input.maxProducts ?? 50;

  log.info(`Starting with ${startUrls.length} start URLs, max ${maxProducts} products`);

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxProducts + 10, // account for collection page + products
    async requestHandler({ request, body }) {
      const url = request.loadedUrl || request.url;

      if (url.includes('/collections/all')) {
        // Step 1: Extract product handles from collection page
        const html = body as string;
        // Also try the Shopify product JSON API approach from meta
        const metaMatch = html.match(/var meta\s*=\s*(\{[\s\S]*?"products"[\s\S]*?\});/);

        if (metaMatch) {
          try {
            const meta = JSON.parse(metaMatch[1]);
            const products = meta.products || [];

            const productsToScrape = products.slice(0, maxProducts);
            log.info(`Found ${products.length} products in Shopify meta, scraping ${productsToScrape.length}`);

            for (const p of productsToScrape) {
              const productUrl = `https://motor-g.com/en/products/${p.handle}`;
              await crawler.addRequests([{ url: productUrl, userData: { productMeta: p } }]);
            }
          } catch (e) {
            log.warning('Failed to parse Shopify meta, falling back to DOM extraction');
            const handles = extractProductHandles(html);
            log.info(`Found ${handles.length} products via DOM`);
            for (const h of handles) {
              await crawler.addRequests([{ url: h.url, userData: { productMeta: h } }]);
            }
          }
        }
      } else if (url.includes('/products/')) {
        // Step 2: Parse product detail page
        const html = body as string;
        const meta = request.userData.productMeta as { handle: string; title: string; id?: string } || {};
        const detailData = parseProductPage(html, url);

        // Try Shopify product JSON as fallback for base data
        let baseData: { title?: string; vendor?: string; type?: string; tags?: string[]; images?: { src: string }[]; variants?: { title: string; price: number }[] } = {};
        try {
          const handle = url.split('/products/')[1]?.split('?')[0];
          if (handle) {
            const jsonUrl = `https://motor-g.com/products/${handle}.js`;
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) {
              baseData = await jsonResp.json() as { title: string; vendor: string; type: string; tags: string[]; images: { src: string }[]; variants: { title: string; price: number }[] };
            }
          }
        } catch { /* ignore */ }

        const $ = cheerio.load(html);
        const rawTitle = baseData.title || $('h1').first().text().trim() || meta.title || '';
        const title = normalizeTitle(rawTitle);

        const product: Product = {
          productId: meta.id?.toString() || '',
          title,
          handle: url.split('/products/')[1]?.split('?')[0] || '',
          url,
          vendor: baseData.vendor || 'motor-g',
          type: baseData.type || '',
          tags: baseData.tags || [],
          price: baseData.variants?.[0]?.price ? baseData.variants[0].price / 100 : (detailData.variants?.[0]?.price || 0),
          currency: 'UAH',
          description: detailData.description || '',
          specs: detailData.specs || {},
          variants: baseData.variants
            ? baseData.variants
                .filter(v => !/(?:[Іі]нш[еі]|[Oo]ther)/.test(v.title))
                .map(v => ({ kv: v.title, price: v.price / 100, currency: 'UAH', available: true }))
                .concat([{ kv: 'Custom/Other KV', price: baseData.variants![0]?.price / 100 || 0, currency: 'UAH', available: true }])
            : (detailData.variants || []),
          images: (baseData.images || []).map(i => {
            const src = typeof i === 'string' ? i : (i as { src?: string }).src || '';
            return src.startsWith('//') ? `https:${src}` : src;
          }),
          scrapedAt: new Date().toISOString(),
        };

        await Actor.pushData(product);
        log.info(`Scraped: ${product.title}`);
      }
    },
  });

  await crawler.run(startUrls);

  log.info('Scraping complete!');
  await Actor.exit();
}

main().catch(async (err) => {
  console.error(err);
  await Actor.exit({ exitCode: 1 });
});
