import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import { loadLocalEnv } from '../server/env.js';

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL。请先在 .env.local 中填写 Neon Postgres 连接字符串。');
  process.exit(1);
}

const sqlitePath = 'data/app.sqlite';
if (!existsSync(sqlitePath)) {
  console.error(`未找到 SQLite 数据库：${sqlitePath}`);
  process.exit(1);
}

const { initDatabase } = await import('../server/database-postgres.js');
await initDatabase();

const sqlite = new DatabaseSync(sqlitePath);
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  prepare: false,
  onnotice: () => {},
});

const tables = [
  {
    name: 'sites',
    columns: [
      'id',
      'domain',
      'origin',
      'name',
      'is_own_site',
      'min_product_price',
      'extract_rule_json',
      'last_product_sync_at',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'products',
    columns: [
      'id',
      'site_id',
      'shopify_product_id',
      'handle',
      'title',
      'vendor',
      'price',
      'compare_at_price',
      'currency',
      'landing_page_url',
      'raw_json',
      'is_hidden',
      'hidden_at',
      'last_price_sync_at',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'competitor_relations',
    columns: [
      'id',
      'own_product_id',
      'competitor_product_id',
      'note',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'spec_extractions',
    columns: [
      'id',
      'product_id',
      'provider',
      'model',
      'input_text',
      'input_hash',
      'output_json',
      'status',
      'error_message',
      'created_at',
    ],
  },
  {
    name: 'product_specs',
    columns: [
      'id',
      'product_id',
      'spec_key',
      'spec_label',
      'spec_order',
      'value',
      'unit',
      'raw_text',
      'source_type',
      'confidence',
      'conflict',
      'main_selling_rank',
      'manually_verified',
      'extraction_id',
      'updated_at',
    ],
  },
  {
    name: 'reports',
    columns: [
      'id',
      'own_product_id',
      'content_markdown',
      'analysis_json',
      'input_snapshot_json',
      'provider',
      'model',
      'created_at',
    ],
  },
];

function readRows(table) {
  return sqlite.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name} ORDER BY id ASC`).all();
}

function rowValues(table, row) {
  return table.columns.map((column) => row[column] ?? null);
}

function rowObject(table, row) {
  const values = rowValues(table, row);
  return Object.fromEntries(table.columns.map((column, index) => [column, values[index]]));
}

async function resetSequence(tx, tableName) {
  await tx.unsafe(`
    SELECT setval(
      pg_get_serial_sequence('${tableName}', 'id'),
      COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
      (SELECT COUNT(*) > 0 FROM ${tableName})
    )
  `);
}

await sql.begin(async (tx) => {
  for (const table of [...tables].reverse()) {
    await tx.unsafe(`DELETE FROM ${table.name}`);
  }

  for (const table of tables) {
    const rows = readRows(table);
    if (rows.length === 0) {
      console.log(`${table.name}: 0`);
      await resetSequence(tx, table.name);
      continue;
    }

    await tx`INSERT INTO ${tx(table.name)} ${tx(rows.map((row) => rowObject(table, row)), ...table.columns)}`;
    await resetSequence(tx, table.name);
    console.log(`${table.name}: ${rows.length}`);
  }
});

const counts = Object.fromEntries(await Promise.all(tables.map(async (table) => {
  const rows = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${table.name}`);
  return [table.name, rows[0].count];
})));

await sql.end();
sqlite.close();

console.log('SQLite -> Postgres 数据迁移完成：');
console.log(JSON.stringify(counts, null, 2));
