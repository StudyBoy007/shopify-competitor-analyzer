import { centsToCurrency } from './shopify.js';
import { EBIKE_SPEC_FIELDS, emptySpecs } from './specSchema.js';
import { getRuntimeSetting } from './settings.js';

function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini 未返回 JSON');
    return JSON.parse(match[0]);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableGeminiStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function friendlyGeminiError(label, status, detail) {
  if (status === 503) {
    return `${label}失败：Gemini 当前繁忙，请稍后再试。系统已经自动重试过，仍然返回 503。`;
  }
  if (status === 429) {
    return `${label}失败：Gemini 请求频率或额度受限，请稍后再试。`;
  }
  return `${label}失败：${status} ${detail}`;
}

async function callGeminiApi({ apiKey, model, body, label }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxAttempts = Number(await getRuntimeSetting('GEMINI_MAX_RETRIES', '3'));
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) return response.json();

      const detail = await response.text();
      if (!isRetryableGeminiStatus(response.status) || attempt === maxAttempts) {
        throw new Error(friendlyGeminiError(label, response.status, detail));
      }
      lastError = new Error(friendlyGeminiError(label, response.status, detail));
    } catch (error) {
      if (attempt === maxAttempts) {
        throw lastError || error;
      }
      lastError = error;
    }

    await sleep(1200 * attempt);
  }

  throw lastError || new Error(`${label}失败：Gemini 调用异常`);
}

function normalizeSpecs(payload) {
  const specs = Array.isArray(payload?.specs) ? payload.specs : [];
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const usedMainRanks = new Set();

  return emptySpecs().map((item) => {
    const spec = byKey.get(item.key);
    if (!spec) return item;
    const rank = Number(spec.main_selling_rank);
    const mainSellingRank = [1, 2, 3].includes(rank) && !usedMainRanks.has(rank) ? rank : null;
    if (mainSellingRank) usedMainRanks.add(mainSellingRank);
    return {
      ...item,
      value: spec.value ?? null,
      unit: spec.unit ?? null,
      raw_text: spec.raw_text ?? null,
      source_type: spec.source_type ?? null,
      confidence: Number(spec.confidence ?? 0),
      conflict: Boolean(spec.conflict),
      main_selling_rank: mainSellingRank,
    };
  });
}

function localFallbackSpecs(product, specText) {
  const text = `${product.title}\n${specText}`;
  const specs = emptySpecs();
  const set = (key, value, rawText = value, confidence = 0.55) => {
    const item = specs.find((spec) => spec.key === key);
    if (item && value) {
      item.value = value;
      item.raw_text = rawText;
      item.source_type = 'local-rule';
      item.confidence = confidence;
    }
  };

  set('product_name', product.title, product.title, 0.9);
  set('current_price', centsToCurrency(product.price), String(product.price), 0.95);
  set('compare_at_price', centsToCurrency(product.compare_at_price), String(product.compare_at_price), 0.95);

  const patterns = [
    ['motor_peak_power', /\b(?:peak\s*)?(\d{3,4})\s*w\b/i],
    ['torque', /\b(\d{2,3})\s*(?:n\.?m|nm)\b/i],
    ['battery_voltage', /\b(\d{2,3})\s*v\b/i],
    ['battery_capacity_ah', /\b(\d{1,2}(?:\.\d+)?)\s*ah\b/i],
    ['battery_capacity_wh', /\b(\d{3,4})\s*wh\b/i],
    ['top_speed', /\b(\d{2,3})\s*mph\b/i],
    ['range', /\b(?:up to\s*)?(\d{2,3})\s*(?:miles|mile|mi)\b/i],
    ['payload_capacity', /\b(\d{2,3})\s*(?:lbs|lb|kg)\b/i],
  ];

  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) set(key, match[0], match[0]);
  }

  return specs;
}

function buildSpecPrompt(product, specText) {
  const fields = EBIKE_SPEC_FIELDS.map(([key, label], index) => `${index + 1}. ${key}: ${label}`).join('\n');
  return `
你是 ebike 商品参数抽取器。只从输入文本中抽取参数，不允许猜测。
没有明确证据的字段返回 null。必须只输出 JSON，不要输出 Markdown。

字段固定如下，并严格按顺序输出：
${fields}

每个字段格式：
{
  "key": "字段 key",
  "value": "抽取值或 null",
  "unit": "单位或 null",
  "raw_text": "支撑该值的原文或 null",
  "source_type": "specification/details/highlight/json/local 或 null",
  "confidence": 0 到 1,
  "conflict": true 或 false,
  "main_selling_rank": 1、2、3 或 null
}

主打参数判断：
- 你需要判断这个落地页主要靠哪些参数抢占市场，例如强动力、长续航、大电池、低价格、轻量、质保等。
- 最多只能给 3 个字段打上 main_selling_rank。
- main_selling_rank=1 表示最核心主打参数，2 表示第二主打，3 表示第三主打。
- 只给落地页明确强调、且有证据支撑的参数打标；不确定就返回 null。
- 同一个 rank 只能出现一次。

商品上下文：
标题：${product.title}
价格：${centsToCurrency(product.price)}
划线价：${centsToCurrency(product.compare_at_price)}
落地页：${product.landing_page_url}

待抽取文本：
${specText}

输出 JSON schema：
{
  "specs": []
}
`.trim();
}

export async function extractSpecsWithGemini(product, specText) {
  const apiKey = await getRuntimeSetting('GEMINI_API_KEY');
  const model = await getRuntimeSetting('GEMINI_MODEL', 'gemini-2.5-flash');
  const prompt = buildSpecPrompt(product, specText);

  if (!apiKey) {
    return {
      provider: 'local-rule',
      model: 'fallback',
      inputText: prompt,
      outputJson: JSON.stringify({ specs: localFallbackSpecs(product, specText) }),
      specs: localFallbackSpecs(product, specText),
    };
  }

  const data = await callGeminiApi({
    apiKey,
    model,
    label: 'Gemini 参数解析',
    body: {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    },
  });
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') || '';
  const parsed = extractJson(text);
  const specs = normalizeSpecs(parsed);

  return {
    provider: 'gemini',
    model,
    inputText: prompt,
    outputJson: JSON.stringify(parsed),
    specs,
  };
}

function specValue(specs, key) {
  const spec = specs.find((item) => item.spec_key === key || item.key === key);
  return spec?.value || '未获取';
}

function buildReportPrompt({ ownProduct, competitorProducts, ownSpecs, competitorSpecsMap }) {
  const competitors = competitorProducts.map((product) => ({
    id: product.id,
    title: product.title,
    price: centsToCurrency(product.price),
    compareAtPrice: centsToCurrency(product.compare_at_price),
    specs: competitorSpecsMap[product.id] || [],
  }));

  return `
你是 ebike 竞品分析师。请基于输入的我方商品和竞品商品参数，生成中文 Markdown 竞品分析报告。
不要编造没有证据的参数。缺失项要说明“未获取”。

我方商品：
${JSON.stringify({ ownProduct, specs: ownSpecs }, null, 2)}

竞品商品：
${JSON.stringify(competitors, null, 2)}

输出结构：
1. 报告摘要
2. 价格与核心参数对比
3. 我方商品 vs 每个竞品商品的优势和劣势
4. 整体竞争态势
5. 可优化建议
`.trim();
}

function localReport({ ownProduct, competitorProducts, ownSpecs, competitorSpecsMap }) {
  const lines = [];
  lines.push(`# ${ownProduct.title} 竞品分析报告`);
  lines.push('');
  lines.push('## 核心参数对比');
  lines.push('');
  lines.push('| 参数 | 我方商品 | ' + competitorProducts.map((item) => item.title).join(' | ') + ' |');
  lines.push('|---|' + ['---', ...competitorProducts.map(() => '---')].join('|') + '|');

  const keys = ['current_price', 'motor_rated_power', 'motor_peak_power', 'torque', 'battery_capacity_ah', 'range', 'top_speed', 'brake_type', 'bike_weight', 'payload_capacity'];
  const labels = Object.fromEntries(EBIKE_SPEC_FIELDS);

  for (const key of keys) {
    const row = [
      labels[key] || key,
      specValue(ownSpecs, key),
      ...competitorProducts.map((product) => specValue(competitorSpecsMap[product.id] || [], key)),
    ];
    lines.push(`| ${row.join(' | ')} |`);
  }

  lines.push('');
  lines.push('## 逐竞品分析');
  for (const product of competitorProducts) {
    lines.push('');
    lines.push(`### ${ownProduct.title} vs ${product.title}`);
    lines.push(`- 价格：我方 ${centsToCurrency(ownProduct.price)}，竞品 ${centsToCurrency(product.price)}。`);
    lines.push('- 参数分析：当前使用本地规则生成摘要；配置 Gemini 后会生成更细的优势、劣势和营销建议。');
  }

  return lines.join('\n');
}

export async function generateReportWithGemini(payload) {
  const apiKey = await getRuntimeSetting('GEMINI_API_KEY');
  const model = await getRuntimeSetting('GEMINI_MODEL', 'gemini-2.5-flash');

  if (!apiKey) {
    return {
      provider: 'local-rule',
      model: 'fallback',
      markdown: localReport(payload),
    };
  }

  const prompt = buildReportPrompt(payload);
  const data = await callGeminiApi({
    apiKey,
    model,
    label: 'Gemini 报告生成',
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    },
  });
  const markdown = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') || '';
  return { provider: 'gemini', model, markdown };
}

function buildReportAnalysisPrompt({ ownProduct, competitorProducts, ownSpecs, competitorSpecsMap }) {
  return `
你是 ebike 竞品分析师。请基于我方商品和竞品商品参数，输出“我方商品 vs 每个竞品”的总结性优劣势对比。
要求：
- 只基于输入参数，不要编造。
- 每个竞品只输出一条 conclusion。
- conclusion 控制在 45 个中文字以内，越简洁越好。
- 要同时概括我方相对该竞品的主要优势和劣势；如果信息不足，直接说“数据不足”。
- 让用户一眼能看懂，不要写长段落。
- 必须只输出 JSON，不要 Markdown。

我方商品：
${JSON.stringify({ ownProduct, specs: ownSpecs }, null, 2)}

竞品商品：
${JSON.stringify(competitorProducts.map((product) => ({
  id: product.id,
  title: product.title,
  domain: product.domain,
  price: centsToCurrency(product.price),
  compareAtPrice: centsToCurrency(product.compare_at_price),
  specs: competitorSpecsMap[product.id] || [],
})), null, 2)}

输出 JSON schema：
{
  "comparisons": [
    {
      "competitor_product_id": 123,
      "conclusion": "我方价格低但续航弱，适合预算用户"
    }
  ]
}
`.trim();
}

function localReportAnalysis({ competitorProducts }) {
  return competitorProducts.map((product) => ({
    competitor_product_id: product.id,
    competitor_title: product.title,
    conclusion: '待 LLM 分析',
  }));
}

function normalizeReportAnalysis(payload, competitorProducts) {
  const items = Array.isArray(payload?.comparisons) ? payload.comparisons : [];
  const byId = new Map(items.map((item) => [Number(item.competitor_product_id), item]));
  return competitorProducts.map((product) => {
    const item = byId.get(Number(product.id));
    return {
      competitor_product_id: product.id,
      competitor_title: product.title,
      conclusion: String(item?.conclusion || '').trim() || '数据不足',
    };
  });
}

export async function generateReportAnalysisWithGemini(payload) {
  const apiKey = await getRuntimeSetting('GEMINI_API_KEY');
  const model = await getRuntimeSetting('GEMINI_MODEL', 'gemini-2.5-flash');

  if (!apiKey) {
    return {
      provider: 'local-rule',
      model: 'fallback',
      comparisons: localReportAnalysis(payload),
    };
  }

  const prompt = buildReportAnalysisPrompt(payload);
  const data = await callGeminiApi({
    apiKey,
    model,
    label: 'Gemini 分析生成',
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    },
  });
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') || '';
  const parsed = extractJson(text);
  return {
    provider: 'gemini',
    model,
    comparisons: normalizeReportAnalysis(parsed, payload.competitorProducts),
  };
}
