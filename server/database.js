import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EBIKE_SPEC_FIELDS, SPEC_FIELD_MAP } from './specSchema.js';

const dbPath = resolve(process.cwd(), 'data/app.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL,
      name TEXT,
      is_own_site INTEGER NOT NULL DEFAULT 0,
      min_product_price INTEGER NOT NULL DEFAULT 30000,
      extract_rule_json TEXT,
      last_product_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      shopify_product_id TEXT,
      handle TEXT NOT NULL,
      title TEXT,
      vendor TEXT,
      price INTEGER,
      compare_at_price INTEGER,
      currency TEXT DEFAULT 'USD',
      landing_page_url TEXT NOT NULL,
      raw_json TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      unavailable_at TEXT,
      last_price_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(site_id, handle),
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS competitor_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      own_product_id INTEGER NOT NULL,
      competitor_product_id INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(own_product_id, competitor_product_id),
      FOREIGN KEY(own_product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(competitor_product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS spec_extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      input_text TEXT,
      input_hash TEXT,
      output_json TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_specs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      spec_key TEXT NOT NULL,
      spec_label TEXT NOT NULL,
      spec_order INTEGER NOT NULL,
      value TEXT,
      unit TEXT,
      raw_text TEXT,
      source_type TEXT,
      confidence REAL,
      conflict INTEGER NOT NULL DEFAULT 0,
      main_selling_rank INTEGER,
      manually_verified INTEGER NOT NULL DEFAULT 0,
      extraction_id INTEGER,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id, spec_key),
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(extraction_id) REFERENCES spec_extractions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      own_product_id INTEGER NOT NULL,
      content_markdown TEXT,
      analysis_json TEXT,
      input_snapshot_json TEXT,
      provider TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(own_product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  ensureColumn('sites', 'extract_rule_json', 'TEXT');
  ensureColumn('products', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('products', 'hidden_at', 'TEXT');
  ensureColumn('products', 'is_available', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('products', 'unavailable_at', 'TEXT');
  ensureColumn('spec_extractions', 'input_hash', 'TEXT');
  ensureColumn('product_specs', 'main_selling_rank', 'INTEGER');
  ensureColumn('reports', 'analysis_json', 'TEXT');
}

function now() {
  return new Date().toISOString();
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

export function listSites() {
  return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM products p WHERE p.site_id = s.id AND p.is_available = 1 AND p.is_hidden = 0) AS product_count,
      (SELECT COUNT(*) FROM products p WHERE p.site_id = s.id AND p.is_available = 1 AND p.is_hidden = 1) AS hidden_product_count,
      (SELECT COUNT(*) FROM products p WHERE p.site_id = s.id AND p.is_available = 0) AS unavailable_product_count
    FROM sites s
    ORDER BY s.is_own_site DESC, s.created_at DESC
  `).all();
}

export function createSite({ domain, origin, name, minProductPrice }) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO sites (domain, origin, name, min_product_price, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(domain, origin, name || domain, minProductPrice, timestamp, timestamp);
  return getSite(result.lastInsertRowid);
}

export function getSite(id) {
  return db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
}

export function updateSite(id, fields) {
  const current = getSite(id);
  if (!current) throw new Error('站点不存在');

  const next = {
    name: fields.name ?? current.name,
    min_product_price: fields.minProductPrice ?? current.min_product_price,
    updated_at: now(),
  };

  db.prepare(`
    UPDATE sites
    SET name = ?, min_product_price = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.min_product_price, next.updated_at, id);
  return getSite(id);
}

export function updateSiteExtractRule(id, ruleJson) {
  const site = getSite(id);
  if (!site) throw new Error('站点不存在');
  db.prepare(`
    UPDATE sites
    SET extract_rule_json = ?, updated_at = ?
    WHERE id = ?
  `).run(ruleJson || null, now(), id);
  return getSite(id);
}

export function setOwnSite(id) {
  const site = getSite(id);
  if (!site) throw new Error('站点不存在');
  const existing = db.prepare('SELECT * FROM sites WHERE is_own_site = 1 AND id != ?').get(id);
  if (existing) {
    throw new Error(`当前我方站点是 ${existing.domain}，请先取消后再设置新的我方站点`);
  }

  db.prepare('UPDATE sites SET is_own_site = 1, updated_at = ? WHERE id = ?').run(now(), id);
  return getSite(id);
}

export function unsetOwnSite(id) {
  db.prepare('UPDATE sites SET is_own_site = 0, updated_at = ? WHERE id = ?').run(now(), id);
  return getSite(id);
}

export function upsertProducts(siteId, products) {
  const timestamp = now();
  const handles = products.map((product) => product.handle).filter(Boolean);
  const statement = db.prepare(`
    INSERT INTO products (
      site_id, shopify_product_id, handle, title, vendor, price, compare_at_price,
      landing_page_url, raw_json, last_price_sync_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id, handle) DO UPDATE SET
      shopify_product_id = excluded.shopify_product_id,
      title = excluded.title,
      vendor = excluded.vendor,
      price = excluded.price,
      compare_at_price = excluded.compare_at_price,
      landing_page_url = excluded.landing_page_url,
      raw_json = excluded.raw_json,
      is_available = 1,
      unavailable_at = NULL,
      last_price_sync_at = excluded.last_price_sync_at,
      updated_at = excluded.updated_at
  `);

  db.exec('BEGIN');
  try {
    if (handles.length > 0) {
      const placeholders = handles.map(() => '?').join(',');
      db.prepare(`
        UPDATE products
        SET is_available = 0,
          unavailable_at = COALESCE(unavailable_at, ?),
          updated_at = ?
        WHERE site_id = ? AND handle NOT IN (${placeholders})
      `).run(timestamp, timestamp, siteId, ...handles);
    } else {
      db.prepare(`
        UPDATE products
        SET is_available = 0,
          unavailable_at = COALESCE(unavailable_at, ?),
          updated_at = ?
        WHERE site_id = ?
      `).run(timestamp, timestamp, siteId);
    }

    for (const product of products) {
      statement.run(
        siteId,
        product.shopify_product_id,
        product.handle,
        product.title,
        product.vendor,
        product.price,
        product.compare_at_price,
        product.landing_page_url,
        product.raw_json,
        timestamp,
        timestamp,
        timestamp,
      );
    }
    db.prepare('UPDATE sites SET last_product_sync_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, siteId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return products.length;
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

export function listProducts({ siteId, q, ownOnly, includeHidden, page, pageSize } = {}) {
  const where = [];
  const params = [];

  where.push('p.is_available = 1');

  if (!includeHidden) {
    where.push('p.is_hidden = 0');
  }

  if (siteId) {
    where.push('p.site_id = ?');
    params.push(siteId);
  }

  if (ownOnly) {
    where.push('s.is_own_site = 1');
  }

  if (q) {
    where.push('(p.title LIKE ? OR p.handle LIKE ?)');
    params.push(`${q}%`, `${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const shouldPaginate = page !== undefined || pageSize !== undefined;
  const currentPage = shouldPaginate ? normalizePage(page) : 1;
  const currentPageSize = shouldPaginate ? normalizePageSize(pageSize) : null;
  const offset = (currentPage - 1) * currentPageSize;
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM products p
    JOIN sites s ON s.id = p.site_id
    ${whereSql}
  `).get(...params).count;

  const sql = `
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
    ${shouldPaginate ? 'LIMIT ? OFFSET ?' : ''}
  `;

  const queryParams = shouldPaginate ? [...params, currentPageSize, offset] : params;
  return {
    items: db.prepare(sql).all(...queryParams),
    total,
    page: currentPage,
    pageSize: currentPageSize || total,
  };
}

export function getProduct(id) {
  return db.prepare(`
    SELECT p.*, s.domain, s.origin, s.is_own_site,
      (
        SELECT MAX(se.created_at)
        FROM spec_extractions se
        WHERE se.product_id = p.id AND se.status = 'success'
      ) AS latest_spec_extracted_at
    FROM products p
    JOIN sites s ON s.id = p.site_id
    WHERE p.id = ?
  `).get(id);
}

export function setProductHidden(id, hidden) {
  const product = getProduct(id);
  if (!product) throw new Error('商品不存在');
  const timestamp = now();
  db.prepare(`
    UPDATE products
    SET is_hidden = ?, hidden_at = ?, updated_at = ?
    WHERE id = ?
  `).run(hidden ? 1 : 0, hidden ? timestamp : null, timestamp, id);
  return getProduct(id);
}

export function createRelation({ ownProductId, competitorProductId, note }) {
  const own = getProduct(ownProductId);
  const competitor = getProduct(competitorProductId);
  if (!own || !competitor) throw new Error('商品不存在');
  if (!own.is_available || !competitor.is_available) throw new Error('已下架商品不能维护竞品关系');
  if (own.is_hidden || competitor.is_hidden) throw new Error('隐藏商品不能维护竞品关系');
  if (!own.is_own_site) throw new Error('请选择我方站点下的商品作为我方商品');
  if (competitor.is_own_site) throw new Error('竞品商品不能来自我方站点');

  const timestamp = now();
  db.prepare(`
    INSERT OR IGNORE INTO competitor_relations (own_product_id, competitor_product_id, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(ownProductId, competitorProductId, note || '', timestamp, timestamp);

  return db.prepare('SELECT * FROM competitor_relations WHERE own_product_id = ? AND competitor_product_id = ?')
    .get(ownProductId, competitorProductId);
}

export function deleteRelation(id) {
  db.prepare('DELETE FROM competitor_relations WHERE id = ?').run(id);
  return { success: true };
}

export function listRelations({ ownProductId, ownSiteOnly, q, page, pageSize } = {}) {
  const params = [];
  const where = [];
  if (ownProductId) {
    where.push('r.own_product_id = ?');
    params.push(ownProductId);
  }
  if (ownSiteOnly) {
    where.push('own_site.is_own_site = 1');
  }
  where.push('own.is_available = 1');
  where.push('competitor.is_available = 1');
  where.push('own.is_hidden = 0');
  where.push('competitor.is_hidden = 0');
  if (q) {
    where.push('(own.title LIKE ? OR own.handle LIKE ? OR competitor.title LIKE ? OR competitor.handle LIKE ? OR competitor_site.domain LIKE ?)');
    params.push(`${q}%`, `${q}%`, `${q}%`, `${q}%`, `${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const shouldPaginate = page !== undefined || pageSize !== undefined;
  const currentPage = shouldPaginate ? normalizePage(page) : 1;
  const currentPageSize = shouldPaginate ? normalizePageSize(pageSize) : null;
  const offset = (currentPage - 1) * currentPageSize;
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM competitor_relations r
    JOIN products own ON own.id = r.own_product_id
    JOIN sites own_site ON own_site.id = own.site_id
    JOIN products competitor ON competitor.id = r.competitor_product_id
    JOIN sites competitor_site ON competitor_site.id = competitor.site_id
    ${whereSql}
  `).get(...params).count;

  return {
    items: db.prepare(`
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
    ${shouldPaginate ? 'LIMIT ? OFFSET ?' : ''}
  `).all(...(shouldPaginate ? [...params, currentPageSize, offset] : params)),
    total,
    page: currentPage,
    pageSize: currentPageSize || total,
  };
}

export function listOwnProductsWithRelations() {
  return db.prepare(`
    SELECT p.*, s.domain, s.origin, s.is_own_site,
      COUNT(r.id) AS relation_count,
      (
        SELECT MAX(se.created_at)
        FROM spec_extractions se
        WHERE se.product_id = p.id AND se.status = 'success'
      ) AS latest_spec_extracted_at
    FROM products p
    JOIN sites s ON s.id = p.site_id
    JOIN competitor_relations r ON r.own_product_id = p.id
    WHERE s.is_own_site = 1 AND p.is_available = 1 AND p.is_hidden = 0
    GROUP BY p.id
    ORDER BY MAX(r.updated_at) DESC, p.updated_at DESC
  `).all();
}

export function createExtraction({ productId, provider, model, inputText, inputHash, outputJson, status, errorMessage }) {
  const result = db.prepare(`
    INSERT INTO spec_extractions (product_id, provider, model, input_text, input_hash, output_json, status, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(productId, provider, model, inputText, inputHash || null, outputJson, status, errorMessage || null, now());
  return result.lastInsertRowid;
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

function normalizeProductMainSellingRanks(productId) {
  const rows = db.prepare(`
    SELECT spec_key, main_selling_rank
    FROM product_specs
    WHERE product_id = ? AND main_selling_rank IN (1, 2, 3)
    ORDER BY main_selling_rank ASC, updated_at DESC, spec_order ASC
  `).all(productId);
  const usedRanks = new Set();
  for (const row of rows) {
    if (!usedRanks.has(row.main_selling_rank)) {
      usedRanks.add(row.main_selling_rank);
      continue;
    }
    db.prepare(`
      UPDATE product_specs
      SET main_selling_rank = NULL, updated_at = ?
      WHERE product_id = ? AND spec_key = ?
    `).run(now(), productId, row.spec_key);
  }
}

function applyComputedSpecs(productId) {
  const rows = db.prepare(`
    SELECT *
    FROM product_specs
    WHERE product_id = ? AND spec_key IN ('battery_voltage', 'battery_capacity_ah', 'battery_capacity_wh')
  `).all(productId);
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
  db.prepare(`
    INSERT INTO product_specs (
      product_id, spec_key, spec_label, spec_order, value, unit, raw_text,
      source_type, confidence, conflict, main_selling_rank, manually_verified, extraction_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, ?)
    ON CONFLICT(product_id, spec_key) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      raw_text = excluded.raw_text,
      source_type = excluded.source_type,
      confidence = excluded.confidence,
      conflict = 0,
      main_selling_rank = NULL,
      manually_verified = 0,
      extraction_id = NULL,
      updated_at = excluded.updated_at
  `).run(
    productId,
    field.key,
    field.label,
    field.order,
    wh,
    'Wh',
    `${voltage} V × ${capacityAh} Ah = ${wh} Wh`,
    'computed',
    1,
    now(),
  );
}

export function upsertSpecs(productId, specs, extractionId) {
  const timestamp = now();
  const statement = db.prepare(`
    INSERT INTO product_specs (
      product_id, spec_key, spec_label, spec_order, value, unit, raw_text,
      source_type, confidence, conflict, main_selling_rank, extraction_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, spec_key) DO UPDATE SET
      spec_label = excluded.spec_label,
      spec_order = excluded.spec_order,
      value = excluded.value,
      unit = excluded.unit,
      raw_text = excluded.raw_text,
      source_type = excluded.source_type,
      confidence = excluded.confidence,
      conflict = excluded.conflict,
      main_selling_rank = excluded.main_selling_rank,
      extraction_id = excluded.extraction_id,
      updated_at = excluded.updated_at
  `);

  db.exec('BEGIN');
  try {
    for (const spec of specs) {
      const field = SPEC_FIELD_MAP.get(spec.key);
      if (!field) continue;
      statement.run(
        productId,
        field.key,
        field.label,
        field.order,
        spec.value ?? null,
        spec.unit ?? null,
        spec.raw_text ?? null,
        spec.source_type ?? null,
        Number(spec.confidence ?? 0),
        spec.conflict ? 1 : 0,
        normalizeMainSellingRank(spec.main_selling_rank),
        extractionId,
        timestamp,
      );
    }
    applyComputedSpecs(productId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listSpecs(productId) {
  const rows = db.prepare(`
    SELECT *
    FROM product_specs
    WHERE product_id = ?
    ORDER BY spec_order ASC
  `).all(productId);
  const byKey = new Map(rows.map((row) => [row.spec_key, row]));

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

export function latestExtraction(productId) {
  return db.prepare(`
    SELECT *
    FROM spec_extractions
    WHERE product_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(productId);
}

export function latestSuccessfulExtraction(productId) {
  return db.prepare(`
    SELECT *
    FROM spec_extractions
    WHERE product_id = ? AND status = 'success'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(productId);
}

export function updateSpecManually(productId, specKey, fields) {
  const field = SPEC_FIELD_MAP.get(specKey);
  if (!field) throw new Error('参数字段不存在');
  const timestamp = now();
  const mainSellingRank = normalizeMainSellingRank(fields.mainSellingRank);
  if (mainSellingRank) {
    db.prepare(`
      UPDATE product_specs
      SET main_selling_rank = NULL, updated_at = ?
      WHERE product_id = ? AND spec_key != ? AND main_selling_rank = ?
    `).run(timestamp, productId, field.key, mainSellingRank);
  }
  db.prepare(`
    INSERT INTO product_specs (
      product_id, spec_key, spec_label, spec_order, value, unit, raw_text,
      source_type, confidence, conflict, main_selling_rank, manually_verified, extraction_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)
    ON CONFLICT(product_id, spec_key) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      raw_text = excluded.raw_text,
      source_type = excluded.source_type,
      confidence = excluded.confidence,
      conflict = excluded.conflict,
      main_selling_rank = excluded.main_selling_rank,
      manually_verified = 1,
      updated_at = excluded.updated_at
  `).run(
    productId,
    field.key,
    field.label,
    field.order,
    fields.value ?? null,
    fields.unit ?? null,
    fields.rawText ?? fields.value ?? null,
    'manual-edit',
    1,
    fields.conflict ? 1 : 0,
    mainSellingRank,
    timestamp,
  );
  normalizeProductMainSellingRanks(productId);
  applyComputedSpecs(productId);
  return listSpecs(productId);
}

export function updateSpecsManually(productId, items) {
  if (!Array.isArray(items)) throw new Error('参数更新内容格式不正确');
  db.exec('BEGIN');
  try {
    for (const item of items) {
      updateSpecManually(productId, item.specKey, item);
    }
    normalizeProductMainSellingRanks(productId);
    db.exec('COMMIT');
    return listSpecs(productId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createReport({ ownProductId, contentMarkdown, analysisJson, inputSnapshotJson, provider, model }) {
  const result = db.prepare(`
    INSERT INTO reports (own_product_id, content_markdown, analysis_json, input_snapshot_json, provider, model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ownProductId, contentMarkdown || null, analysisJson || null, inputSnapshotJson, provider || null, model || null, now());
  return getReport(result.lastInsertRowid);
}

export function getReport(id) {
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
}

export function deleteReport(id) {
  const report = getReport(id);
  if (!report) throw new Error('报告不存在');
  db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  return { success: true };
}

export function listReports({ ownProductId } = {}) {
  const params = [];
  const where = [];
  if (ownProductId) {
    where.push('r.own_product_id = ?');
    params.push(ownProductId);
  }
  return db.prepare(`
    SELECT r.*, p.title AS own_title, p.handle AS own_handle
    FROM reports r
    JOIN products p ON p.id = r.own_product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.created_at DESC, r.id DESC
  `).all(...params);
}

export function updateReportAnalysis(id, { analysisJson, provider, model }) {
  const report = getReport(id);
  if (!report) throw new Error('报告不存在');
  db.prepare(`
    UPDATE reports
    SET analysis_json = ?, provider = ?, model = ?
    WHERE id = ?
  `).run(analysisJson, provider || null, model || null, id);
  return getReport(id);
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

export function getUser(id) {
  return db.prepare('SELECT id, username, role, is_active, last_login_at, created_at, updated_at FROM users WHERE id = ?').get(id);
}

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function listUsers() {
  return db.prepare(`
    SELECT id, username, role, is_active, last_login_at, created_at, updated_at
    FROM users
    ORDER BY role ASC, created_at DESC
  `).all();
}

export function createUser({ username, passwordHash, role = 'user' }) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(username, passwordHash, role, timestamp, timestamp);
  return getUser(result.lastInsertRowid);
}

export function updateUserPassword(id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), id);
  return getUser(id);
}

export function setUserActive(id, active) {
  db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, now(), id);
  return getUser(id);
}

export function markUserLogin(id) {
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return getUser(id);
}

export function listSettings() {
  return db.prepare(`
    SELECT setting_key, setting_value, is_secret, updated_by, updated_at
    FROM app_settings
    ORDER BY setting_key ASC
  `).all();
}

export function getSetting(key) {
  return db.prepare('SELECT * FROM app_settings WHERE setting_key = ?').get(key);
}

export function upsertSetting({ key, value, isSecret, updatedBy }) {
  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, is_secret, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      is_secret = excluded.is_secret,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(key, value ?? null, isSecret ? 1 : 0, updatedBy || null, now());
  return getSetting(key);
}

export function createAuditLog({ userId, action, targetType, targetId, detailJson }) {
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, target_type, target_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId || null, action, targetType || null, targetId || null, detailJson || null, now());
  return { success: true };
}
