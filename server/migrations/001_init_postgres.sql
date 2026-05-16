CREATE TABLE IF NOT EXISTS sites (
  id BIGSERIAL PRIMARY KEY,
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
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
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
  UNIQUE(site_id, handle)
);

CREATE TABLE IF NOT EXISTS competitor_relations (
  id BIGSERIAL PRIMARY KEY,
  own_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(own_product_id, competitor_product_id)
);

CREATE TABLE IF NOT EXISTS spec_extractions (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  input_text TEXT,
  input_hash TEXT,
  output_json TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_specs (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_key TEXT NOT NULL,
  spec_label TEXT NOT NULL,
  spec_order INTEGER NOT NULL,
  value TEXT,
  unit TEXT,
  raw_text TEXT,
  source_type TEXT,
  confidence DOUBLE PRECISION,
  conflict INTEGER NOT NULL DEFAULT 0,
  main_selling_rank INTEGER,
  manually_verified INTEGER NOT NULL DEFAULT 0,
  extraction_id BIGINT REFERENCES spec_extractions(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, spec_key)
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  own_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  content_markdown TEXT,
  analysis_json TEXT,
  input_snapshot_json TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_site_id ON products(site_id);
CREATE INDEX IF NOT EXISTS idx_products_hidden ON products(is_hidden);
CREATE INDEX IF NOT EXISTS idx_relations_own_product ON competitor_relations(own_product_id);
CREATE INDEX IF NOT EXISTS idx_specs_product ON product_specs(product_id);
CREATE INDEX IF NOT EXISTS idx_extractions_product ON spec_extractions(product_id);
CREATE INDEX IF NOT EXISTS idx_reports_own_product ON reports(own_product_id);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
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
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
