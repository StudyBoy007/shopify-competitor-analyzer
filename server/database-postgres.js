import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { EBIKE_SPEC_FIELDS, SPEC_FIELD_MAP } from './specSchema.js';

const sql = postgres(process.env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  prepare: false,
  onnotice: () => {},
});

function now() {
  return new Date().toISOString();
}

function first(rows) {
  return rows[0] || null;
}

function normalizeId(value) {
  return value === null || value === undefined ? value : Number(value);
}

function normalizeRow(row) {
  if (!row) return row;
  const next = { ...row };
  for (const key of ['id', 'site_id', 'product_id', 'extraction_id', 'own_product_id', 'competitor_product_id']) {
    if (key in next) next[key] = normalizeId(next[key]);
  }
  return next;
}

function normalizeRows(rows) {
  return rows.map(normalizeRow);
}

function normalizePage(page) {
  const number = Number(page || 1);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 1;
}

function normalizePageSize(pageSize) {
  const number = Number(pageSize || 20);
  if (!Number.isFinite(number) || number <= 0) return 20;
  return Math.min(100, Math.floor(number));
}

function parseSpecNumber(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function formatComputedWh(voltage, capacityAh) {
  const wh = voltage * capacityAh;
  if (!Number.isFinite(wh)) return null;
  return Number.isInteger(wh) ? String(wh) : String(Number(wh.toFixed(1)));
}

function normalizeMainSellingRank(value) {
  const rank = Number(value);
  return [1, 2, 3].includes(rank) ? rank : null;
}

export async function initDatabase() {
  const migrationSql = readFileSync(resolve(process.cwd(), 'server/migrations/001_init_postgres.sql'), 'utf8');
  for (const statement of migrationSql.split(';').map((item) => item.trim()).filter(Boolean)) {
    await sql.unsafe(statement);
  }
}

export async function listSites() {
  const rows = await sql`
    SELECT s.*,
      (SELECT COUNT(*)::int FROM products p WHERE p.site_id = s.id AND p.is_hidden = 0) AS product_count,
      (SELECT COUNT(*)::int FROM products p WHERE p.site_id = s.id AND p.is_hidden = 1) AS hidden_product_count
    FROM sites s
    ORDER BY s.is_own_site DESC, s.created_at DESC
  `;
  return normalizeRows(rows);
}

export async function createSite({ domain, origin, name, minProductPrice }) {
  const timestamp = now();
  const rows = await sql`
    INSERT INTO sites (domain, origin, name, min_product_price, created_at, updated_at)
    VALUES (${domain}, ${origin}, ${name || domain}, ${minProductPrice}, ${timestamp}, ${timestamp})
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function getSite(id) {
  const rows = await sql`SELECT * FROM sites WHERE id = ${id} LIMIT 1`;
  return normalizeRow(first(rows));
}

export async function updateSite(id, fields) {
  const current = await getSite(id);
  if (!current) throw new Error('站点不存在');
  const rows = await sql`
    UPDATE sites
    SET name = ${fields.name ?? current.name},
      min_product_price = ${fields.minProductPrice ?? current.min_product_price},
      updated_at = ${now()}
    WHERE id = ${id}
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function updateSiteExtractRule(id, ruleJson) {
  const site = await getSite(id);
  if (!site) throw new Error('站点不存在');
  const rows = await sql`
    UPDATE sites
    SET extract_rule_json = ${ruleJson || null}, updated_at = ${now()}
    WHERE id = ${id}
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function setOwnSite(id) {
  const site = await getSite(id);
  if (!site) throw new Error('站点不存在');
  const existing = first(await sql`SELECT * FROM sites WHERE is_own_site = 1 AND id != ${id} LIMIT 1`);
  if (existing) throw new Error(`当前我方站点是 ${existing.domain}，请先取消后再设置新的我方站点`);
  const rows = await sql`UPDATE sites SET is_own_site = 1, updated_at = ${now()} WHERE id = ${id} RETURNING *`;
  return normalizeRow(first(rows));
}

export async function unsetOwnSite(id) {
  const rows = await sql`UPDATE sites SET is_own_site = 0, updated_at = ${now()} WHERE id = ${id} RETURNING *`;
  return normalizeRow(first(rows));
}

export async function upsertProducts(siteId, products) {
  const timestamp = now();
  const handles = products.map((product) => product.handle).filter(Boolean);

  await sql.begin(async (tx) => {
    if (handles.length > 0) {
      await tx`DELETE FROM products WHERE site_id = ${siteId} AND handle NOT IN ${tx(handles)}`;
    } else {
      await tx`DELETE FROM products WHERE site_id = ${siteId}`;
    }

    for (const product of products) {
      await tx`
        INSERT INTO products (
          site_id, shopify_product_id, handle, title, vendor, price, compare_at_price,
          landing_page_url, raw_json, last_price_sync_at, created_at, updated_at
        )
        VALUES (
          ${siteId}, ${product.shopify_product_id}, ${product.handle}, ${product.title}, ${product.vendor},
          ${product.price}, ${product.compare_at_price}, ${product.landing_page_url}, ${product.raw_json},
          ${timestamp}, ${timestamp}, ${timestamp}
        )
        ON CONFLICT(site_id, handle) DO UPDATE SET
          shopify_product_id = EXCLUDED.shopify_product_id,
          title = EXCLUDED.title,
          vendor = EXCLUDED.vendor,
          price = EXCLUDED.price,
          compare_at_price = EXCLUDED.compare_at_price,
          landing_page_url = EXCLUDED.landing_page_url,
          raw_json = EXCLUDED.raw_json,
          last_price_sync_at = EXCLUDED.last_price_sync_at,
          updated_at = EXCLUDED.updated_at
      `;
    }
    await tx`UPDATE sites SET last_product_sync_at = ${timestamp}, updated_at = ${timestamp} WHERE id = ${siteId}`;
  });
  return products.length;
}

function buildProductWhere({ siteId, q, ownOnly, includeHidden } = {}, startIndex = 1) {
  const where = [];
  const params = [];
  if (!includeHidden) where.push('p.is_hidden = 0');
  if (siteId) {
    where.push(`p.site_id = $${startIndex + params.length}`);
    params.push(siteId);
  }
  if (ownOnly) where.push('s.is_own_site = 1');
  if (q) {
    where.push(`(p.title LIKE $${startIndex + params.length} OR p.handle LIKE $${startIndex + params.length + 1})`);
    params.push(`${q}%`, `${q}%`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listProducts({ siteId, q, ownOnly, includeHidden, page, pageSize } = {}) {
  const { whereSql, params } = buildProductWhere({ siteId, q, ownOnly, includeHidden });
  const shouldPaginate = page !== undefined || pageSize !== undefined;
  const currentPage = shouldPaginate ? normalizePage(page) : 1;
  const currentPageSize = shouldPaginate ? normalizePageSize(pageSize) : null;
  const offset = (currentPage - 1) * currentPageSize;

  const total = first(await sql.unsafe(`
    SELECT COUNT(*)::int AS count
    FROM products p
    JOIN sites s ON s.id = p.site_id
    ${whereSql}
  `, params)).count;

  const rows = await sql.unsafe(`
    SELECT p.*, s.domain, s.origin, s.is_own_site,
      (
        SELECT MAX(se.created_at)
        FROM spec_extractions se
        WHERE se.product_id = p.id AND se.status = 'success'
      ) AS latest_spec_extracted_at
    FROM products p
    JOIN sites s ON s.id = p.site_id
    ${whereSql}
    ORDER BY p.updated_at DESC, p.id DESC
    ${shouldPaginate ? `LIMIT $${params.length + 1} OFFSET $${params.length + 2}` : ''}
  `, shouldPaginate ? [...params, currentPageSize, offset] : params);

  return {
    items: normalizeRows(rows),
    total,
    page: currentPage,
    pageSize: currentPageSize || total,
  };
}

export async function getProduct(id) {
  const rows = await sql`
    SELECT p.*, s.domain, s.origin, s.is_own_site,
      (
        SELECT MAX(se.created_at)
        FROM spec_extractions se
        WHERE se.product_id = p.id AND se.status = 'success'
      ) AS latest_spec_extracted_at
    FROM products p
    JOIN sites s ON s.id = p.site_id
    WHERE p.id = ${id}
    LIMIT 1
  `;
  return normalizeRow(first(rows));
}

export async function setProductHidden(id, hidden) {
  const product = await getProduct(id);
  if (!product) throw new Error('商品不存在');
  const timestamp = now();
  const rows = await sql`
    UPDATE products
    SET is_hidden = ${hidden ? 1 : 0}, hidden_at = ${hidden ? timestamp : null}, updated_at = ${timestamp}
    WHERE id = ${id}
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function createRelation({ ownProductId, competitorProductId, note }) {
  const own = await getProduct(ownProductId);
  const competitor = await getProduct(competitorProductId);
  if (!own || !competitor) throw new Error('商品不存在');
  if (own.is_hidden || competitor.is_hidden) throw new Error('隐藏商品不能维护竞品关系');
  if (!own.is_own_site) throw new Error('请选择我方站点下的商品作为我方商品');
  if (competitor.is_own_site) throw new Error('竞品商品不能来自我方站点');

  const timestamp = now();
  const rows = await sql`
    INSERT INTO competitor_relations (own_product_id, competitor_product_id, note, created_at, updated_at)
    VALUES (${ownProductId}, ${competitorProductId}, ${note || ''}, ${timestamp}, ${timestamp})
    ON CONFLICT(own_product_id, competitor_product_id) DO NOTHING
    RETURNING *
  `;
  if (rows.length) return normalizeRow(first(rows));
  const existing = await sql`
    SELECT * FROM competitor_relations
    WHERE own_product_id = ${ownProductId} AND competitor_product_id = ${competitorProductId}
    LIMIT 1
  `;
  return normalizeRow(first(existing));
}

export async function deleteRelation(id) {
  await sql`DELETE FROM competitor_relations WHERE id = ${id}`;
  return { success: true };
}

export async function listRelations({ ownProductId, q, page, pageSize } = {}) {
  const where = ['own.is_hidden = 0', 'competitor.is_hidden = 0'];
  const params = [];
  if (ownProductId) {
    where.push(`r.own_product_id = $${params.length + 1}`);
    params.push(ownProductId);
  }
  if (q) {
    where.push(`(competitor.title LIKE $${params.length + 1} OR competitor.handle LIKE $${params.length + 2} OR competitor_site.domain LIKE $${params.length + 3})`);
    params.push(`${q}%`, `${q}%`, `${q}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const shouldPaginate = page !== undefined || pageSize !== undefined;
  const currentPage = shouldPaginate ? normalizePage(page) : 1;
  const currentPageSize = shouldPaginate ? normalizePageSize(pageSize) : null;
  const offset = (currentPage - 1) * currentPageSize;

  const total = first(await sql.unsafe(`
    SELECT COUNT(*)::int AS count
    FROM competitor_relations r
    JOIN products own ON own.id = r.own_product_id
    JOIN sites own_site ON own_site.id = own.site_id
    JOIN products competitor ON competitor.id = r.competitor_product_id
    JOIN sites competitor_site ON competitor_site.id = competitor.site_id
    ${whereSql}
  `, params)).count;

  const rows = await sql.unsafe(`
    SELECT r.*,
      own.title AS own_title,
      own.handle AS own_handle,
      own.price AS own_price,
      own.compare_at_price AS own_compare_at_price,
      own_site.domain AS own_domain,
      competitor.title AS competitor_title,
      competitor.handle AS competitor_handle,
      competitor.price AS competitor_price,
      competitor.compare_at_price AS competitor_compare_at_price,
      competitor_site.domain AS competitor_domain,
      competitor.id AS competitor_product_id
    FROM competitor_relations r
    JOIN products own ON own.id = r.own_product_id
    JOIN sites own_site ON own_site.id = own.site_id
    JOIN products competitor ON competitor.id = r.competitor_product_id
    JOIN sites competitor_site ON competitor_site.id = competitor.site_id
    ${whereSql}
    ORDER BY r.created_at DESC
    ${shouldPaginate ? `LIMIT $${params.length + 1} OFFSET $${params.length + 2}` : ''}
  `, shouldPaginate ? [...params, currentPageSize, offset] : params);

  return {
    items: normalizeRows(rows),
    total,
    page: currentPage,
    pageSize: currentPageSize || total,
  };
}

export async function listOwnProductsWithRelations() {
  const rows = await sql`
    SELECT p.*, s.domain, s.origin, s.is_own_site,
      COUNT(r.id)::int AS relation_count,
      (
        SELECT MAX(se.created_at)
        FROM spec_extractions se
        WHERE se.product_id = p.id AND se.status = 'success'
      ) AS latest_spec_extracted_at
    FROM products p
    JOIN sites s ON s.id = p.site_id
    JOIN competitor_relations r ON r.own_product_id = p.id
    WHERE s.is_own_site = 1 AND p.is_hidden = 0
    GROUP BY p.id, s.id
    ORDER BY MAX(r.updated_at) DESC, p.updated_at DESC
  `;
  return normalizeRows(rows);
}

export async function createExtraction({ productId, provider, model, inputText, inputHash, outputJson, status, errorMessage }) {
  const rows = await sql`
    INSERT INTO spec_extractions (product_id, provider, model, input_text, input_hash, output_json, status, error_message, created_at)
    VALUES (${productId}, ${provider}, ${model}, ${inputText}, ${inputHash || null}, ${outputJson}, ${status}, ${errorMessage || null}, ${now()})
    RETURNING id
  `;
  return Number(first(rows).id);
}

async function normalizeProductMainSellingRanks(productId) {
  const rows = await sql`
    SELECT spec_key, main_selling_rank
    FROM product_specs
    WHERE product_id = ${productId} AND main_selling_rank IN (1, 2, 3)
    ORDER BY main_selling_rank ASC, updated_at DESC, spec_order ASC
  `;
  const usedRanks = new Set();
  for (const row of rows) {
    if (!usedRanks.has(row.main_selling_rank)) {
      usedRanks.add(row.main_selling_rank);
      continue;
    }
    await sql`
      UPDATE product_specs
      SET main_selling_rank = NULL, updated_at = ${now()}
      WHERE product_id = ${productId} AND spec_key = ${row.spec_key}
    `;
  }
}

async function applyComputedSpecs(productId) {
  const rows = await sql`
    SELECT *
    FROM product_specs
    WHERE product_id = ${productId} AND spec_key IN ('battery_voltage', 'battery_capacity_ah', 'battery_capacity_wh')
  `;
  const byKey = new Map(rows.map((row) => [row.spec_key, row]));
  const voltage = parseSpecNumber(byKey.get('battery_voltage')?.value);
  const capacityAh = parseSpecNumber(byKey.get('battery_capacity_ah')?.value);
  if (!voltage || !capacityAh) return;

  const wh = formatComputedWh(voltage, capacityAh);
  if (!wh) return;
  const currentWh = byKey.get('battery_capacity_wh');
  const hasManualValue = currentWh?.manually_verified && String(currentWh.value || '').trim();
  const hasNonComputedValue = currentWh?.value && currentWh.source_type && currentWh.source_type !== 'computed';
  if (hasManualValue || hasNonComputedValue) return;

  const field = SPEC_FIELD_MAP.get('battery_capacity_wh');
  await sql`
    INSERT INTO product_specs (
      product_id, spec_key, spec_label, spec_order, value, unit, raw_text,
      source_type, confidence, conflict, main_selling_rank, manually_verified, extraction_id, updated_at
    )
    VALUES (
      ${productId}, ${field.key}, ${field.label}, ${field.order}, ${wh}, ${'Wh'},
      ${`${voltage} V × ${capacityAh} Ah = ${wh} Wh`}, ${'computed'}, ${1}, ${0}, ${null}, ${0}, ${null}, ${now()}
    )
    ON CONFLICT(product_id, spec_key) DO UPDATE SET
      value = EXCLUDED.value,
      unit = EXCLUDED.unit,
      raw_text = EXCLUDED.raw_text,
      source_type = EXCLUDED.source_type,
      confidence = EXCLUDED.confidence,
      conflict = 0,
      main_selling_rank = NULL,
      manually_verified = 0,
      extraction_id = NULL,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function upsertSpecs(productId, specs, extractionId) {
  const timestamp = now();
  await sql.begin(async (tx) => {
    for (const spec of specs) {
      const field = SPEC_FIELD_MAP.get(spec.key);
      if (!field) continue;
      await tx`
        INSERT INTO product_specs (
          product_id, spec_key, spec_label, spec_order, value, unit, raw_text,
          source_type, confidence, conflict, main_selling_rank, extraction_id, updated_at
        )
        VALUES (
          ${productId}, ${field.key}, ${field.label}, ${field.order}, ${spec.value ?? null}, ${spec.unit ?? null},
          ${spec.raw_text ?? null}, ${spec.source_type ?? null}, ${Number(spec.confidence ?? 0)}, ${spec.conflict ? 1 : 0},
          ${normalizeMainSellingRank(spec.main_selling_rank)}, ${extractionId}, ${timestamp}
        )
        ON CONFLICT(product_id, spec_key) DO UPDATE SET
          spec_label = EXCLUDED.spec_label,
          spec_order = EXCLUDED.spec_order,
          value = EXCLUDED.value,
          unit = EXCLUDED.unit,
          raw_text = EXCLUDED.raw_text,
          source_type = EXCLUDED.source_type,
          confidence = EXCLUDED.confidence,
          conflict = EXCLUDED.conflict,
          main_selling_rank = EXCLUDED.main_selling_rank,
          extraction_id = EXCLUDED.extraction_id,
          updated_at = EXCLUDED.updated_at
      `;
    }
  });
  await applyComputedSpecs(productId);
}

export async function listSpecs(productId) {
  const rows = await sql`
    SELECT *
    FROM product_specs
    WHERE product_id = ${productId}
    ORDER BY spec_order ASC
  `;
  const byKey = new Map(normalizeRows(rows).map((row) => [row.spec_key, row]));
  return EBIKE_SPEC_FIELDS.map(([key, label], index) => {
    const row = byKey.get(key);
    return row || {
      product_id: productId,
      spec_key: key,
      spec_label: label,
      spec_order: index + 1,
      value: null,
      unit: null,
      raw_text: null,
      source_type: null,
      confidence: 0,
      conflict: 0,
      main_selling_rank: null,
      manually_verified: 0,
    };
  });
}

export async function latestExtraction(productId) {
  const rows = await sql`
    SELECT *
    FROM spec_extractions
    WHERE product_id = ${productId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return normalizeRow(first(rows));
}

export async function latestSuccessfulExtraction(productId) {
  const rows = await sql`
    SELECT *
    FROM spec_extractions
    WHERE product_id = ${productId} AND status = 'success'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return normalizeRow(first(rows));
}

export async function updateSpecManually(productId, specKey, fields) {
  const field = SPEC_FIELD_MAP.get(specKey);
  if (!field) throw new Error('参数字段不存在');
  const timestamp = now();
  const mainSellingRank = normalizeMainSellingRank(fields.mainSellingRank);
  if (mainSellingRank) {
    await sql`
      UPDATE product_specs
      SET main_selling_rank = NULL, updated_at = ${timestamp}
      WHERE product_id = ${productId} AND spec_key != ${field.key} AND main_selling_rank = ${mainSellingRank}
    `;
  }
  await sql`
    INSERT INTO product_specs (
      product_id, spec_key, spec_label, spec_order, value, unit, raw_text,
      source_type, confidence, conflict, main_selling_rank, manually_verified, extraction_id, updated_at
    )
    VALUES (
      ${productId}, ${field.key}, ${field.label}, ${field.order}, ${fields.value ?? null}, ${fields.unit ?? null},
      ${fields.rawText ?? fields.value ?? null}, ${'manual-edit'}, ${1}, ${fields.conflict ? 1 : 0}, ${mainSellingRank}, ${1}, ${null}, ${timestamp}
    )
    ON CONFLICT(product_id, spec_key) DO UPDATE SET
      value = EXCLUDED.value,
      unit = EXCLUDED.unit,
      raw_text = EXCLUDED.raw_text,
      source_type = EXCLUDED.source_type,
      confidence = EXCLUDED.confidence,
      conflict = EXCLUDED.conflict,
      main_selling_rank = EXCLUDED.main_selling_rank,
      manually_verified = 1,
      updated_at = EXCLUDED.updated_at
  `;
  await normalizeProductMainSellingRanks(productId);
  await applyComputedSpecs(productId);
  return listSpecs(productId);
}

export async function updateSpecsManually(productId, items) {
  if (!Array.isArray(items)) throw new Error('参数更新内容格式不正确');
  for (const item of items) {
    await updateSpecManually(productId, item.specKey, item);
  }
  await normalizeProductMainSellingRanks(productId);
  return listSpecs(productId);
}

export async function createReport({ ownProductId, contentMarkdown, analysisJson, inputSnapshotJson, provider, model }) {
  const rows = await sql`
    INSERT INTO reports (own_product_id, content_markdown, analysis_json, input_snapshot_json, provider, model, created_at)
    VALUES (${ownProductId}, ${contentMarkdown || null}, ${analysisJson || null}, ${inputSnapshotJson}, ${provider || null}, ${model || null}, ${now()})
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function getReport(id) {
  const rows = await sql`SELECT * FROM reports WHERE id = ${id} LIMIT 1`;
  return normalizeRow(first(rows));
}

export async function deleteReport(id) {
  const report = await getReport(id);
  if (!report) throw new Error('报告不存在');
  await sql`DELETE FROM reports WHERE id = ${id}`;
  return { success: true };
}

export async function listReports({ ownProductId } = {}) {
  const rows = ownProductId
    ? await sql`
      SELECT r.*, p.title AS own_title, p.handle AS own_handle
      FROM reports r
      JOIN products p ON p.id = r.own_product_id
      WHERE r.own_product_id = ${ownProductId}
      ORDER BY r.created_at DESC, r.id DESC
    `
    : await sql`
      SELECT r.*, p.title AS own_title, p.handle AS own_handle
      FROM reports r
      JOIN products p ON p.id = r.own_product_id
      ORDER BY r.created_at DESC, r.id DESC
    `;
  return normalizeRows(rows);
}

export async function updateReportAnalysis(id, { analysisJson, provider, model }) {
  const report = await getReport(id);
  if (!report) throw new Error('报告不存在');
  const rows = await sql`
    UPDATE reports
    SET analysis_json = ${analysisJson}, provider = ${provider || null}, model = ${model || null}
    WHERE id = ${id}
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function countUsers() {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM users`;
  return first(rows).count;
}

export async function getUser(id) {
  const rows = await sql`
    SELECT id, username, role, is_active, last_login_at, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return normalizeRow(first(rows));
}

export async function findUserByUsername(username) {
  const rows = await sql`SELECT * FROM users WHERE username = ${username} LIMIT 1`;
  return normalizeRow(first(rows));
}

export async function listUsers() {
  const rows = await sql`
    SELECT id, username, role, is_active, last_login_at, created_at, updated_at
    FROM users
    ORDER BY role ASC, created_at DESC
  `;
  return normalizeRows(rows);
}

export async function createUser({ username, passwordHash, role = 'user' }) {
  const timestamp = now();
  const rows = await sql`
    INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at)
    VALUES (${username}, ${passwordHash}, ${role}, 1, ${timestamp}, ${timestamp})
    RETURNING id, username, role, is_active, last_login_at, created_at, updated_at
  `;
  return normalizeRow(first(rows));
}

export async function updateUserPassword(id, passwordHash) {
  const rows = await sql`
    UPDATE users
    SET password_hash = ${passwordHash}, updated_at = ${now()}
    WHERE id = ${id}
    RETURNING id, username, role, is_active, last_login_at, created_at, updated_at
  `;
  return normalizeRow(first(rows));
}

export async function setUserActive(id, active) {
  const rows = await sql`
    UPDATE users
    SET is_active = ${active ? 1 : 0}, updated_at = ${now()}
    WHERE id = ${id}
    RETURNING id, username, role, is_active, last_login_at, created_at, updated_at
  `;
  return normalizeRow(first(rows));
}

export async function markUserLogin(id) {
  const timestamp = now();
  const rows = await sql`
    UPDATE users
    SET last_login_at = ${timestamp}, updated_at = ${timestamp}
    WHERE id = ${id}
    RETURNING id, username, role, is_active, last_login_at, created_at, updated_at
  `;
  return normalizeRow(first(rows));
}

export async function listSettings() {
  const rows = await sql`
    SELECT setting_key, setting_value, is_secret, updated_by, updated_at
    FROM app_settings
    ORDER BY setting_key ASC
  `;
  return normalizeRows(rows);
}

export async function getSetting(key) {
  const rows = await sql`SELECT * FROM app_settings WHERE setting_key = ${key} LIMIT 1`;
  return normalizeRow(first(rows));
}

export async function upsertSetting({ key, value, isSecret, updatedBy }) {
  const rows = await sql`
    INSERT INTO app_settings (setting_key, setting_value, is_secret, updated_by, updated_at)
    VALUES (${key}, ${value ?? null}, ${isSecret ? 1 : 0}, ${updatedBy || null}, ${now()})
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = EXCLUDED.setting_value,
      is_secret = EXCLUDED.is_secret,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  return normalizeRow(first(rows));
}

export async function createAuditLog({ userId, action, targetType, targetId, detailJson }) {
  await sql`
    INSERT INTO audit_logs (user_id, action, target_type, target_id, detail_json, created_at)
    VALUES (${userId || null}, ${action}, ${targetType || null}, ${targetId || null}, ${detailJson || null}, ${now()})
  `;
  return { success: true };
}
