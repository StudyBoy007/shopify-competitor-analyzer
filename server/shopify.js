export function normalizeOrigin(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('请输入独立站域名');
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin.replace(/\/$/, '');
}

export function buildLandingPageUrl(origin, handle) {
  return `${origin}/products/${encodeURIComponent(handle)}`;
}

export function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }

  const normalized = String(value).replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;

  if (normalized.includes('.')) {
    return Math.round(number * 100);
  }
  return Math.round(number);
}

export function dollarsToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

export function centsToCurrency(cents) {
  if (cents === null || cents === undefined) return '';
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function pickPrice(product) {
  const variant = product.variants?.[0] || {};
  return toCents(product.price ?? product.price_min ?? variant.price);
}

function pickCompareAtPrice(product) {
  const variant = product.variants?.[0] || {};
  return toCents(product.compare_at_price ?? product.compare_at_price_min ?? variant.compare_at_price);
}

export async function fetchShopifyProducts(origin, minProductPriceCents) {
  const products = [];
  let page = 1;

  while (page < 100) {
    const url = `${origin}/products.json?limit=250&page=${page}`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 Shopify competitor analyzer',
      },
    });

    if (!response.ok) {
      throw new Error(`拉取 products.json 失败：${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const list = Array.isArray(data.products) ? data.products : [];
    if (list.length === 0) break;

    for (const product of list) {
      const price = pickPrice(product);
      const vendor = product.vendor || '';
      if (vendor.trim().toLowerCase() === 'seel') continue;
      if (price === null || price <= minProductPriceCents) continue;

      products.push({
        shopify_product_id: product.id ? String(product.id) : null,
        handle: product.handle,
        title: product.title || product.handle,
        vendor,
        price,
        compare_at_price: pickCompareAtPrice(product),
        landing_page_url: buildLandingPageUrl(origin, product.handle),
        raw_json: JSON.stringify(product),
      });
    }

    if (list.length < 250) break;
    page += 1;
  }

  return products;
}

export async function fetchLandingPage(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 Shopify competitor analyzer',
    },
  });

  if (!response.ok) {
    throw new Error(`抓取落地页失败：${response.status} ${response.statusText}`);
  }

  return response.text();
}

export const DEFAULT_EXTRACT_RULE = {
  keywords: [
    'specification',
    'specifications',
    'technical specs',
    'tech specs',
    'product details',
    'details',
    'geometry',
    'components',
  ],
  excludeKeywords: [
    'reviews',
    'you may also like',
    'related products',
    'shipping',
    'warranty',
    'returns',
  ],
  takeLines: 80,
  fallbackLines: 220,
  maxChars: 18000,
  includeFallback: true,
};

function normalizeKeywordList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? Array.from(new Set(list)) : fallback;
}

function normalizePositiveInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function normalizeExtractRule(rule = {}) {
  const source = rule && typeof rule === 'object' ? rule : {};
  return {
    keywords: normalizeKeywordList(source.keywords, DEFAULT_EXTRACT_RULE.keywords),
    excludeKeywords: normalizeKeywordList(source.excludeKeywords, DEFAULT_EXTRACT_RULE.excludeKeywords),
    takeLines: normalizePositiveInteger(source.takeLines, DEFAULT_EXTRACT_RULE.takeLines, 10, 300),
    fallbackLines: normalizePositiveInteger(source.fallbackLines, DEFAULT_EXTRACT_RULE.fallbackLines, 20, 600),
    maxChars: normalizePositiveInteger(source.maxChars, DEFAULT_EXTRACT_RULE.maxChars, 1000, 40000),
    includeFallback: source.includeFallback === undefined ? DEFAULT_EXTRACT_RULE.includeFallback : Boolean(source.includeFallback),
  };
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h1|h2|h3|h4|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectChunk(lines, startIndex, rule) {
  const chunk = [];
  for (let index = startIndex; index < Math.min(lines.length, startIndex + rule.takeLines); index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    if (index > startIndex && rule.excludeKeywords.some((keyword) => lower.includes(keyword))) {
      break;
    }
    chunk.push(line);
  }
  return chunk.join('\n');
}

export function extractSpecText(html, ruleInput = {}) {
  const rule = normalizeExtractRule(ruleInput);
  const text = stripHtml(html);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase();
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      const chunk = collectChunk(lines, index, rule);
      if (chunk && !seen.has(chunk)) {
        seen.add(chunk);
        chunks.push(chunk);
      }
    }
  }

  const source = chunks.length > 0
    ? chunks.join('\n\n---\n\n')
    : (rule.includeFallback ? lines.slice(0, rule.fallbackLines).join('\n') : '');
  return source.slice(0, rule.maxChars);
}
