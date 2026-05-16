import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './env.js';
import {
  countUsers,
  createAuditLog,
  createExtraction,
  createRelation,
  createReport,
  createSite,
  createUser,
  deleteRelation,
  deleteReport,
  findUserByUsername,
  getUser,
  getProduct,
  getReport,
  listSettings,
  listUsers,
  markUserLogin,
  getSite,
  initDatabase,
  latestExtraction,
  latestSuccessfulExtraction,
  listOwnProductsWithRelations,
  listProducts,
  listRelations,
  listReports,
  listSites,
  listSpecs,
  setUserActive,
  setProductHidden,
  setOwnSite,
  unsetOwnSite,
  updateReportAnalysis,
  updateSiteExtractRule,
  updateSite,
  updateSpecManually,
  updateSpecsManually,
  updateUserPassword,
  upsertProducts,
  upsertSpecs,
} from './database-adapter.js';
import { extractSpecsWithGemini, generateReportAnalysisWithGemini } from './gemini.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';
import { publicSetting, saveSetting } from './settings.js';
import {
  DEFAULT_EXTRACT_RULE,
  buildLandingPageUrl,
  dollarsToCents,
  extractSpecText,
  fetchLandingPage,
  fetchShopifyProducts,
  normalizeExtractRule,
  normalizeOrigin,
} from './shopify.js';

let readyPromise = null;

export async function ensureServerReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      loadLocalEnv();
      await initDatabase();
      await ensureInitialAdmin();
    })();
  }
  return readyPromise;
}

async function ensureInitialAdmin() {
  if (await countUsers() > 0) return;
  const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const password = process.env.INITIAL_ADMIN_PASSWORD || process.env.ACCESS_PASSWORD;
  if (!password) {
    console.warn('未配置 INITIAL_ADMIN_PASSWORD 或 ACCESS_PASSWORD，跳过初始化管理员账号。');
    return;
  }
  await createUser({
    username,
    passwordHash: await hashPassword(password),
    role: 'admin',
  });
  console.log(`已初始化管理员账号：${username}`);
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,x-access-password,authorization',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error, statusCode = 500) {
  console.error(error);
  sendJson(res, { error: error.message || '服务异常' }, statusCode);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function routeKey(method, pathname) {
  return `${method.toUpperCase()} ${pathname}`;
}

function isPublicRoute(pathname) {
  return pathname === '/api/health' || pathname === '/api/auth/login';
}

async function authenticateRequest(req, pathname) {
  if (isPublicRoute(pathname)) return null;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload?.sub) return null;
  const user = await getUser(Number(payload.sub));
  return user?.is_active ? user : null;
}

function requireAdmin(user) {
  if (user?.role !== 'admin') throw new Error('需要管理员权限');
}

function productMatches(pathname, suffix = '') {
  const match = pathname.match(new RegExp(`^/api/products/(\\d+)${suffix}$`));
  return match ? Number(match[1]) : null;
}

async function syncSiteProducts(siteId) {
  const site = await getSite(siteId);
  if (!site) throw new Error('站点不存在');
  const products = await fetchShopifyProducts(site.origin, site.min_product_price);
  const count = await upsertProducts(site.id, products);
  return { site: await getSite(site.id), count };
}

function hashText(text) {
  return createHash('sha256').update(String(text || '').trim()).digest('hex');
}

function parseRuleJson(ruleJson) {
  if (!ruleJson) return null;
  let parsed;
  try {
    parsed = typeof ruleJson === 'string' ? JSON.parse(ruleJson) : ruleJson;
  } catch {
    throw new Error('规则 JSON 格式不正确，请检查逗号、引号和括号');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('规则必须是 JSON 对象');
  }
  return parsed;
}

async function getSiteRule(siteId) {
  const site = await getSite(siteId);
  return parseRuleJson(site?.extract_rule_json);
}

function stringifyRule(ruleJson) {
  const parsed = parseRuleJson(ruleJson);
  if (!parsed) return null;
  normalizeExtractRule(parsed);
  return JSON.stringify(parsed, null, 2);
}

function extractionSupportsMainSelling(extraction) {
  if (!extraction?.output_json) return false;
  try {
    const parsed = JSON.parse(extraction.output_json);
    return Array.isArray(parsed?.specs)
      && parsed.specs.some((spec) => Object.prototype.hasOwnProperty.call(spec, 'main_selling_rank'));
  } catch {
    return false;
  }
}

async function hasUsableSpecs(productId) {
  return (await listSpecs(productId)).some((spec) => String(spec.value || '').trim());
}

async function extractProductSpecs(productId) {
  const product = await getProduct(productId);
  if (!product) throw new Error('商品不存在');

  const html = await fetchLandingPage(product.landing_page_url);
  const specText = extractSpecText(html, await getSiteRule(product.site_id));
  const inputHash = hashText(specText);
  const latestSuccess = await latestSuccessfulExtraction(productId);

  if (
    latestSuccess?.input_hash
    && latestSuccess.input_hash === inputHash
    && extractionSupportsMainSelling(latestSuccess)
  ) {
    return {
      skipped: true,
      reason: '落地页规格内容未变化，已跳过 LLM 调用',
      inputHash,
      latestExtraction: latestSuccess,
      specs: await listSpecs(productId),
    };
  }

  try {
    const result = await extractSpecsWithGemini(product, specText);
    const extractionId = await createExtraction({
      productId,
      provider: result.provider,
      model: result.model,
      inputText: result.inputText,
      inputHash,
      outputJson: result.outputJson,
      status: 'success',
    });
    await upsertSpecs(productId, result.specs, extractionId);
    return {
      extractionId,
      provider: result.provider,
      model: result.model,
      inputHash,
      skipped: false,
      specs: await listSpecs(productId),
    };
  } catch (error) {
    await createExtraction({
      productId,
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      inputText: specText,
      inputHash,
      outputJson: null,
      status: 'failed',
      errorMessage: error.message,
    });
    throw error;
  }
}

async function refreshProductSpecsForReport(productId) {
  const product = await getProduct(productId);
  if (!product) {
    return { productId, ok: false, skipped: true, message: '商品不存在，已跳过刷新' };
  }

  try {
    const result = await extractProductSpecs(productId);
    return {
      productId,
      title: product.title,
      ok: true,
      skipped: Boolean(result.skipped),
      message: result.reason || '参数刷新完成',
    };
  } catch (error) {
    if (await hasUsableSpecs(productId)) {
      return {
        productId,
        title: product.title,
        ok: false,
        fallback: true,
        message: `${product.title} 刷新失败，已沿用已有参数：${error.message}`,
      };
    }
    throw error;
  }
}

async function buildReportSnapshot(ownProductId, selectedCompetitorProductIds) {
  const freshOwnProduct = await getProduct(ownProductId);
  if (!freshOwnProduct) throw new Error('我方商品不存在');
  const competitorProducts = (await Promise.all(selectedCompetitorProductIds.map(getProduct))).filter(Boolean);
  const ownSpecs = await listSpecs(ownProductId);
  const competitorSpecsMap = Object.fromEntries(
    await Promise.all(competitorProducts.map(async (product) => [product.id, await listSpecs(product.id)])),
  );
  return {
    ownProduct: freshOwnProduct,
    competitorProducts,
    ownSpecs,
    competitorSpecsMap,
    selectedCompetitorProductIds,
  };
}

export async function handleRequest(req, res) {
  await ensureServerReady();

  if (req.method === 'OPTIONS') {
    sendJson(res, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  const currentUser = await authenticateRequest(req, pathname);
  if (!isPublicRoute(pathname) && !currentUser) {
    sendJson(res, { error: '请先登录' }, 401);
    return;
  }

  try {
    const key = routeKey(req.method, pathname);

    if (key === 'GET /api/health') {
      sendJson(res, { ok: true, time: new Date().toISOString() });
      return;
    }

    if (key === 'POST /api/auth/login') {
      const body = await readBody(req);
      const user = await findUserByUsername(String(body.username || '').trim());
      if (!user || !user.is_active || !(await verifyPassword(body.password, user.password_hash))) {
        sendJson(res, { error: '账号或密码不正确' }, 401);
        return;
      }
      const publicUser = await markUserLogin(user.id);
      sendJson(res, { token: signToken(publicUser), user: publicUser });
      return;
    }

    if (key === 'GET /api/auth/me') {
      sendJson(res, { user: currentUser });
      return;
    }

    if (key === 'GET /api/admin/users') {
      requireAdmin(currentUser);
      sendJson(res, { users: await listUsers() });
      return;
    }

    if (key === 'POST /api/admin/users') {
      requireAdmin(currentUser);
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      if (!username || !body.password) throw new Error('请输入账号和密码');
      const user = await createUser({
        username,
        passwordHash: await hashPassword(body.password),
        role: body.role === 'admin' ? 'admin' : 'user',
      });
      await createAuditLog({
        userId: currentUser.id,
        action: 'user.create',
        targetType: 'user',
        targetId: String(user.id),
        detailJson: JSON.stringify({ username: user.username, role: user.role }),
      });
      sendJson(res, { user }, 201);
      return;
    }

    const adminUserPasswordMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (req.method === 'PATCH' && adminUserPasswordMatch) {
      requireAdmin(currentUser);
      const body = await readBody(req);
      if (!body.password) throw new Error('请输入新密码');
      const user = await updateUserPassword(Number(adminUserPasswordMatch[1]), await hashPassword(body.password));
      await createAuditLog({
        userId: currentUser.id,
        action: 'user.password_reset',
        targetType: 'user',
        targetId: String(user.id),
      });
      sendJson(res, { user });
      return;
    }

    const adminUserActiveMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/active$/);
    if (req.method === 'PATCH' && adminUserActiveMatch) {
      requireAdmin(currentUser);
      const body = await readBody(req);
      if (Number(adminUserActiveMatch[1]) === currentUser.id && body.active === false) {
        throw new Error('不能停用当前登录的管理员账号');
      }
      const user = await setUserActive(Number(adminUserActiveMatch[1]), Boolean(body.active));
      await createAuditLog({
        userId: currentUser.id,
        action: user.is_active ? 'user.activate' : 'user.deactivate',
        targetType: 'user',
        targetId: String(user.id),
      });
      sendJson(res, { user });
      return;
    }

    if (key === 'GET /api/admin/settings') {
      requireAdmin(currentUser);
      sendJson(res, { settings: (await listSettings()).map(publicSetting) });
      return;
    }

    if (key === 'PATCH /api/admin/settings') {
      requireAdmin(currentUser);
      const body = await readBody(req);
      const keyName = String(body.key || '').trim();
      if (!keyName) throw new Error('配置 key 不能为空');
      const setting = await saveSetting({
        key: keyName,
        value: body.value ?? '',
        isSecret: Boolean(body.isSecret),
        updatedBy: currentUser.id,
      });
      await createAuditLog({
        userId: currentUser.id,
        action: 'setting.update',
        targetType: 'setting',
        targetId: keyName,
        detailJson: JSON.stringify({ isSecret: Boolean(body.isSecret) }),
      });
      sendJson(res, { setting: publicSetting(setting) });
      return;
    }

    if (key === 'GET /api/sites') {
      sendJson(res, { sites: await listSites() });
      return;
    }

    if (key === 'POST /api/sites') {
      const body = await readBody(req);
      const origin = normalizeOrigin(body.domain);
      const domain = new URL(origin).hostname;
      const minProductPrice = dollarsToCents(body.minProductPrice || 300) ?? 30000;
      const site = await createSite({ domain, origin, name: body.name, minProductPrice });
      sendJson(res, { site }, 201);
      return;
    }

    const sitePatchMatch = pathname.match(/^\/api\/sites\/(\d+)$/);
    if (req.method === 'PATCH' && sitePatchMatch) {
      const body = await readBody(req);
      const site = await updateSite(Number(sitePatchMatch[1]), {
        ...body,
        minProductPrice: body.minProductPrice === undefined ? undefined : dollarsToCents(body.minProductPrice),
      });
      sendJson(res, { site });
      return;
    }

    const siteSyncMatch = pathname.match(/^\/api\/sites\/(\d+)\/sync-products$/);
    if (req.method === 'POST' && siteSyncMatch) {
      sendJson(res, await syncSiteProducts(Number(siteSyncMatch[1])));
      return;
    }

    const siteRuleMatch = pathname.match(/^\/api\/sites\/(\d+)\/extract-rule$/);
    if (req.method === 'GET' && siteRuleMatch) {
      const site = await getSite(Number(siteRuleMatch[1]));
      if (!site) throw new Error('站点不存在');
      sendJson(res, {
        site,
        ruleJson: site.extract_rule_json || '',
        defaultRule: DEFAULT_EXTRACT_RULE,
      });
      return;
    }

    if (req.method === 'PATCH' && siteRuleMatch) {
      const body = await readBody(req);
      const ruleJson = stringifyRule(body.ruleJson);
      const site = await updateSiteExtractRule(Number(siteRuleMatch[1]), ruleJson);
      sendJson(res, { site, ruleJson: site.extract_rule_json || '' });
      return;
    }

    const siteRuleTestMatch = pathname.match(/^\/api\/sites\/(\d+)\/test-extract-rule$/);
    if (req.method === 'POST' && siteRuleTestMatch) {
      const siteId = Number(siteRuleTestMatch[1]);
      const site = await getSite(siteId);
      if (!site) throw new Error('站点不存在');
      const body = await readBody(req);
      const rule = body.ruleJson !== undefined ? parseRuleJson(body.ruleJson) : parseRuleJson(site.extract_rule_json);
      let landingPageUrl = body.landingPageUrl;
      let product = null;
      if (body.productId) {
        product = await getProduct(Number(body.productId));
        if (!product) throw new Error('商品不存在');
        if (product.site_id !== siteId) throw new Error('请选择当前站点下的商品测试规则');
        landingPageUrl = product.landing_page_url;
      }
      if (!landingPageUrl) throw new Error('请选择商品或输入落地页 URL');

      const html = await fetchLandingPage(landingPageUrl);
      const text = extractSpecText(html, rule);
      sendJson(res, {
        product,
        landingPageUrl,
        text,
        hash: hashText(text),
        length: text.length,
      });
      return;
    }

    const setOwnMatch = pathname.match(/^\/api\/sites\/(\d+)\/set-own$/);
    if (req.method === 'POST' && setOwnMatch) {
      sendJson(res, { site: await setOwnSite(Number(setOwnMatch[1])) });
      return;
    }

    const unsetOwnMatch = pathname.match(/^\/api\/sites\/(\d+)\/unset-own$/);
    if (req.method === 'POST' && unsetOwnMatch) {
      sendJson(res, { site: await unsetOwnSite(Number(unsetOwnMatch[1])) });
      return;
    }

    if (key === 'GET /api/products') {
      const result = await listProducts({
        siteId: url.searchParams.get('siteId') ? Number(url.searchParams.get('siteId')) : null,
        q: url.searchParams.get('q') || '',
        ownOnly: url.searchParams.get('ownOnly') === '1',
        includeHidden: url.searchParams.get('includeHidden') === '1',
        page: url.searchParams.get('page') || undefined,
        pageSize: url.searchParams.get('pageSize') || undefined,
      });
      sendJson(res, {
        products: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
      return;
    }

    if (key === 'GET /api/report-own-products') {
      sendJson(res, { products: await listOwnProductsWithRelations() });
      return;
    }

    const productId = productMatches(pathname);
    if (req.method === 'GET' && productId) {
      const product = await getProduct(productId);
      if (!product) throw new Error('商品不存在');
      sendJson(res, {
        product,
        specs: await listSpecs(productId),
        latestExtraction: await latestExtraction(productId),
      });
      return;
    }

    const fetchPageProductId = productMatches(pathname, '/fetch-page');
    if (req.method === 'POST' && fetchPageProductId) {
      const product = await getProduct(fetchPageProductId);
      if (!product) throw new Error('商品不存在');
      const html = await fetchLandingPage(product.landing_page_url);
      sendJson(res, { text: extractSpecText(html, await getSiteRule(product.site_id)) });
      return;
    }

    const extractProductId = productMatches(pathname, '/extract-specs');
    if (req.method === 'POST' && extractProductId) {
      sendJson(res, await extractProductSpecs(extractProductId));
      return;
    }

    const productHiddenId = productMatches(pathname, '/hidden');
    if (req.method === 'PATCH' && productHiddenId) {
      const body = await readBody(req);
      sendJson(res, { product: await setProductHidden(productHiddenId, Boolean(body.hidden)) });
      return;
    }

    const specsPatchProductId = productMatches(pathname, '/specs');
    if (req.method === 'PATCH' && specsPatchProductId) {
      const body = await readBody(req);
      const specs = await updateSpecsManually(specsPatchProductId, body.specs || []);
      sendJson(res, { specs });
      return;
    }

    const specPatchMatch = pathname.match(/^\/api\/products\/(\d+)\/specs\/([^/]+)$/);
    if (req.method === 'PATCH' && specPatchMatch) {
      const body = await readBody(req);
      const specs = await updateSpecManually(Number(specPatchMatch[1]), decodeURIComponent(specPatchMatch[2]), body);
      sendJson(res, { specs });
      return;
    }

    const refreshPriceProductId = productMatches(pathname, '/refresh-price');
    if (req.method === 'POST' && refreshPriceProductId) {
      const product = await getProduct(refreshPriceProductId);
      if (!product) throw new Error('商品不存在');
      sendJson(res, await syncSiteProducts(product.site_id));
      return;
    }

    if (key === 'GET /api/relations') {
      const result = await listRelations({
        ownProductId: url.searchParams.get('ownProductId') ? Number(url.searchParams.get('ownProductId')) : null,
        ownSiteOnly: url.searchParams.get('ownSiteOnly') === '1',
        q: url.searchParams.get('q') || '',
        page: url.searchParams.get('page') || undefined,
        pageSize: url.searchParams.get('pageSize') || undefined,
      });
      sendJson(res, {
        relations: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
      return;
    }

    if (key === 'POST /api/relations') {
      const body = await readBody(req);
      const relation = await createRelation({
        ownProductId: Number(body.ownProductId),
        competitorProductId: Number(body.competitorProductId),
        note: body.note,
      });

      let extraction = null;
      let extractionError = null;
      if (body.extractSpecs !== false) {
        try {
          extraction = await extractProductSpecs(Number(body.competitorProductId));
        } catch (error) {
          extractionError = error.message;
        }
      }

      sendJson(res, { relation, extraction, extractionError }, 201);
      return;
    }

    const relationDeleteMatch = pathname.match(/^\/api\/relations\/(\d+)$/);
    if (req.method === 'DELETE' && relationDeleteMatch) {
      sendJson(res, await deleteRelation(Number(relationDeleteMatch[1])));
      return;
    }

    if (key === 'POST /api/reports') {
      const body = await readBody(req);
      const ownProductId = Number(body.ownProductId);
      const selectedCompetitorProductIds = body.selectedCompetitorProductIds?.map(Number) || [];
      const ownProduct = await getProduct(ownProductId);
      if (!ownProduct) throw new Error('我方商品不存在');
      if (selectedCompetitorProductIds.length === 0) throw new Error('请至少选择一个竞品商品');

      if (body.refreshPrice) {
        await syncSiteProducts(ownProduct.site_id);
        for (const competitorId of selectedCompetitorProductIds) {
          const competitor = await getProduct(competitorId);
          if (competitor) await syncSiteProducts(competitor.site_id);
        }
      }

      if (body.refreshSpecs) {
        const refreshWarnings = [];
        const ownRefresh = await refreshProductSpecsForReport(ownProductId);
        if (!ownRefresh.ok) refreshWarnings.push(ownRefresh);
        for (const competitorId of selectedCompetitorProductIds) {
          const competitorRefresh = await refreshProductSpecsForReport(competitorId);
          if (!competitorRefresh.ok) refreshWarnings.push(competitorRefresh);
        }
        body.refreshWarnings = refreshWarnings;
      }

      const snapshot = await buildReportSnapshot(ownProductId, selectedCompetitorProductIds);
      const report = await createReport({
        ownProductId,
        contentMarkdown: null,
        analysisJson: null,
        inputSnapshotJson: JSON.stringify(snapshot),
        provider: null,
        model: null,
      });
      sendJson(res, { report, refreshWarnings: body.refreshWarnings || [] });
      return;
    }

    if (key === 'POST /api/reports/preview') {
      const body = await readBody(req);
      const ownProductId = Number(body.ownProductId);
      const selectedCompetitorProductIds = body.selectedCompetitorProductIds?.map(Number) || [];
      if (!ownProductId) throw new Error('请选择我方商品');
      sendJson(res, { snapshot: await buildReportSnapshot(ownProductId, selectedCompetitorProductIds) });
      return;
    }

    if (key === 'GET /api/reports') {
      sendJson(res, {
        reports: await listReports({
          ownProductId: url.searchParams.get('ownProductId') ? Number(url.searchParams.get('ownProductId')) : null,
        }),
      });
      return;
    }

    const reportMatch = pathname.match(/^\/api\/reports\/(\d+)$/);
    if (req.method === 'GET' && reportMatch) {
      const report = await getReport(Number(reportMatch[1]));
      if (!report) throw new Error('报告不存在');
      sendJson(res, { report });
      return;
    }

    if (req.method === 'DELETE' && reportMatch) {
      sendJson(res, await deleteReport(Number(reportMatch[1])));
      return;
    }

    const reportAnalyzeMatch = pathname.match(/^\/api\/reports\/(\d+)\/analysis$/);
    if (req.method === 'POST' && reportAnalyzeMatch) {
      const report = await getReport(Number(reportAnalyzeMatch[1]));
      if (!report) throw new Error('报告不存在');
      const snapshot = JSON.parse(report.input_snapshot_json || '{}');
      const result = await generateReportAnalysisWithGemini({
        ownProduct: snapshot.ownProduct,
        competitorProducts: snapshot.competitorProducts || [],
        ownSpecs: snapshot.ownSpecs || [],
        competitorSpecsMap: snapshot.competitorSpecsMap || {},
      });
      const updatedReport = await updateReportAnalysis(report.id, {
        analysisJson: JSON.stringify({ comparisons: result.comparisons }),
        provider: result.provider,
        model: result.model,
      });
      sendJson(res, { report: updatedReport });
      return;
    }

    if (key === 'POST /api/tools/landing-url') {
      const body = await readBody(req);
      const origin = normalizeOrigin(body.domain);
      sendJson(res, { url: buildLandingPageUrl(origin, body.handle) });
      return;
    }

    sendJson(res, { error: '接口不存在' }, 404);
  } catch (error) {
    sendError(res, error, error.message?.includes('不存在') ? 404 : 400);
  }
}

function isDirectRun() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isDirectRun()) {
  await ensureServerReady();
  const port = Number(process.env.LOCAL_API_PORT || 5174);
  const host = process.env.LOCAL_API_HOST || '127.0.0.1';

  createServer(handleRequest).listen(port, host, () => {
    console.log(`本地 API 已启动：http://${host}:${port}`);
  });
}
