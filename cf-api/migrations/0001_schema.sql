-- JAYACLEAN D1 Schema (migrated from Supabase PostgreSQL)
-- SQLite dialect. Triggers/RLS/Functions replaced with application logic in Workers.

PRAGMA foreign_keys = ON;

-- ============================================================
-- profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id         TEXT PRIMARY KEY,                    -- UUID from auth
  full_name  TEXT NOT NULL DEFAULT '',
  phone      TEXT DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff')),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  email      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  service_area TEXT DEFAULT '',
  password   TEXT NOT NULL DEFAULT '',            -- hashed (PBKDF2)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique ON profiles(email) WHERE email <> '';

-- No default admin password is stored in migrations. Provision credentials out of band.
INSERT OR IGNORE INTO profiles (id, full_name, phone, role, is_active, email, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Abdul Latif', '60139373275', 'admin', 1, 'banktifweb1@gmail.com', datetime('now'));

-- ============================================================
-- app_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- seed defaults
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('business_name', 'Jaya Bina Services'),
  ('bank_name', ''),
  ('bank_account_no', ''),
  ('bank_account_holder', ''),
  ('qr_image_url', ''),
  ('price_total', '300'),
  ('price_deposit', '150'),
  ('price_balance', '150'),
  ('wa_business_number', '60139373275'),
  ('wa_tmpl_baki', 'Salam {nama}, kerja cuci tangki air di {alamat} telah siap. Sila jelaskan baki bayaran RM{baki} ke akaun {bank} {akaun} ({pemegang}). QR bank: {qr_url}. Terima kasih kerana memilih {business}.'),
  ('wa_tmpl_staff', 'Salam {nama_staff}, anda ditugaskan kerja cuci tangki: Pelanggan {nama} di {alamat} pada {tarikh} ({slot}). Lokasi: {maps}'),
  ('coverage_area', 'Lembah Klang'),
  ('max_slots_per_day', '4'),
  ('slots', '9am,11am,2pm,4pm'),
  ('auto_assign_enabled', 'false'),
  ('auto_assign_rule', 'round_robin'),
  ('auto_confirm_payment', 'true'),
  ('auto_complete_task', 'false'),
  ('auto_send_wa_balance', 'false'),
  ('service_areas', ''),
  ('wa_api_enabled', 'false'),
  ('cloud_name', 'dkibczut'),
  ('upload_preset', 'jayaclean_tasks'),
  ('folder', 'jayaclean/tasks'),
  ('active_homepage', 'v1');

-- ============================================================
-- private_settings (admin-only secrets)
-- ============================================================
CREATE TABLE IF NOT EXISTS private_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ============================================================
-- customers
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id                 TEXT PRIMARY KEY,
  phone              TEXT NOT NULL UNIQUE,
  name               TEXT DEFAULT '',
  email              TEXT DEFAULT '',
  address            TEXT DEFAULT '',
  notes              TEXT DEFAULT '',
  tags               TEXT DEFAULT '[]',            -- JSON array as text
  status             TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','vip','blacklist')),
  total_bookings     INTEGER DEFAULT 0,
  completed_bookings INTEGER DEFAULT 0,
  total_spent        REAL DEFAULT 0,
  first_booking_date TEXT,
  last_booking_date  TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_last_booking ON customers(last_booking_date DESC);

-- ============================================================
-- bookings
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                      TEXT PRIMARY KEY,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  customer_name           TEXT NOT NULL,
  customer_phone          TEXT NOT NULL,
  customer_address        TEXT NOT NULL,
  booking_date            TEXT NOT NULL,           -- DATE as TEXT (YYYY-MM-DD)
  booking_time            TEXT NOT NULL,           -- '9am','11am','2pm','4pm' or custom
  amount                  REAL NOT NULL DEFAULT 300,
  deposit_amount          REAL NOT NULL DEFAULT 150,
  payment_status          TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
  bayarcash_ref           TEXT,
  bayarcash_transaction_id TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','confirmed','completed','cancelled')),
  notes                   TEXT,
  customer_id             TEXT REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);

-- ============================================================
-- slots
-- ============================================================
CREATE TABLE IF NOT EXISTS slots (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,                        -- DATE as TEXT (YYYY-MM-DD)
  time_slot  TEXT NOT NULL,
  is_booked  INTEGER NOT NULL DEFAULT 0 CHECK(is_booked IN (0,1)),
  booking_id TEXT REFERENCES bookings(id)
);

CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_date_time_booked ON slots(date, time_slot) WHERE is_booked = 1;

-- ============================================================
-- tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  assigned_to TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'unassigned' CHECK(status IN ('unassigned','assigned','in_progress','awaiting_review','completed','cancelled')),
  started_at  TEXT,
  finished_at TEXT,
  completed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_booking_id ON tasks(booking_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ============================================================
-- task_photos
-- ============================================================
CREATE TABLE IF NOT EXISTS task_photos (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('before','after')),
  url         TEXT NOT NULL,
  uploaded_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_photos_task_id ON task_photos(task_id);

-- ============================================================
-- backup_log (new - tracks backup history)
-- ============================================================
CREATE TABLE IF NOT EXISTS backup_log (
  id         TEXT PRIMARY KEY,
  destination TEXT NOT NULL,                       -- 'r2' or 'drive'
  filename   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ok',           -- 'ok' or 'error'
  error_msg  TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backup_log_dest ON backup_log(destination, created_at DESC);
