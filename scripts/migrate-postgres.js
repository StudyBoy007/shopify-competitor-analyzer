import { loadLocalEnv } from '../server/env.js';

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL。请先在 .env.local 中填写 Neon Postgres 连接字符串。');
  process.exit(1);
}

const { initDatabase } = await import('../server/database-postgres.js');
await initDatabase();
console.log('Postgres 建表迁移完成。');
