const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

// DB_PATH is overridable (e.g. ":memory:" or a temp file) so tests never
// touch the real dev database — see server/test/*.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "water_system.db");
const isNewDb = DB_PATH === ":memory:" || !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initSchema() {
  db.exec(`
    -- ─────────────────────────────────────────────────────────
    -- Households: one row per connected water account
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,              -- e.g. "HH-001"
      name TEXT NOT NULL,               -- resident full name on the account
      standpost INTEGER NOT NULL,
      meter TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      date_connected TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Resident accounts: login credentials for a household.
    -- A household can be claimed by either:
    --   (a) a household password (set on first login), or
    --   (b) a linked Google account (google_sub / google_email)
    -- Both can coexist once a resident links Google after
    -- already having a password, or vice versa.
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS resident_accounts (
      household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      password_hash TEXT,               -- bcrypt hash, null until first login sets one
      google_sub TEXT UNIQUE,           -- Google's stable user id ("sub" claim)
      google_email TEXT,
      google_name TEXT,
      google_picture TEXT,
      reset_code_hash TEXT,
      reset_code_expires TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Admin accounts
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS admin_accounts (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'officer', -- officer (full access) | collector (payments only)
      reset_code_hash TEXT,
      reset_code_expires TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Announcements posted by the water office, shown to residents
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'info',   -- info | success | warn
      title TEXT NOT NULL,
      tag TEXT,
      content TEXT NOT NULL,
      published_date TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Billing periods (e.g. "May 2026") with per-household bills
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      period TEXT NOT NULL,             -- "May 2026"
      prev_cm3 INTEGER NOT NULL,
      curr_cm3 INTEGER NOT NULL,
      amount REAL NOT NULL,
      prev_balance REAL NOT NULL DEFAULT 0,
      total_due REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'Unpaid', -- Unpaid | GCash Pending | Paid
      payment_method TEXT,              -- GCash | Offline
      payment_ref TEXT,
      payment_date TEXT,
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(household_id, period)
    );

    -- ─────────────────────────────────────────────────────────
    -- Raw sensor readings (IoT flow data)
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      cm3 REAL NOT NULL,
      flow_rate REAL NOT NULL,
      flow_type TEXT NOT NULL DEFAULT 'Normal', -- Normal | High flow
      pulses INTEGER,                   -- raw pulse count reported by the device for this reading, if any
      source TEXT NOT NULL DEFAULT 'device', -- device | manual | mock
      recorded_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Alerts (leak / high-flow notifications shown to admin)
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,              -- "ALT-941"
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      type TEXT NOT NULL,               -- Leak Detected | High Flow | No Sensor Data
      flow_rate TEXT,
      threshold TEXT DEFAULT '50 L/m',
      status TEXT NOT NULL DEFAULT 'Unresolved', -- Unresolved | Resolved
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Leak reports submitted by residents
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS leak_reports (
      id TEXT PRIMARY KEY,              -- "LK-123456"
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'minor', -- minor | moderate | major
      contact_back INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Open', -- Open | In Progress | Resolved
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Audit log: who did what (staff actions), for accountability
    -- across the officer / collector roles.
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_email TEXT,
      actor_role TEXT,                  -- officer | collector
      action TEXT NOT NULL,             -- e.g. "bill.mark_paid"
      target TEXT,                      -- e.g. "HH-004"
      details TEXT,                     -- human-readable summary
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- Small key/value store for admin-configurable system settings
    -- (currently: real-time leak / abnormal-usage detection thresholds).
    -- Read fresh on every detection check, so a change here takes effect
    -- immediately with no server restart.
    -- ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bills_household ON bills(household_id);
    CREATE INDEX IF NOT EXISTS idx_readings_household ON readings(household_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_household ON alerts(household_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  `);

  // Migration: add columns to households that may not exist on a DB file
  // created before these fields were introduced.
  const householdColumns = db.prepare("PRAGMA table_info(households)").all().map((c) => c.name);
  if (!householdColumns.includes("phone")) {
    db.exec("ALTER TABLE households ADD COLUMN phone TEXT");
  }
  if (!householdColumns.includes("email")) {
    db.exec("ALTER TABLE households ADD COLUMN email TEXT");
  }
  // IoT flow-sensor device (Arduino/ESP + pulse sensor) fields. device_key is
  // the secret the device authenticates with (X-Device-Key header) — never
  // exposed over the public /api/residents endpoint, only to admins.
  // pulses_per_liter is the calibration constant for the attached sensor
  // (e.g. ~450 for a YF-S201 hall-effect flow sensor); admins can recalibrate
  // it without reflashing the device, since volume math happens server-side.
  if (!householdColumns.includes("device_key")) {
    db.exec("ALTER TABLE households ADD COLUMN device_key TEXT");
  }
  if (!householdColumns.includes("pulses_per_liter")) {
    db.exec("ALTER TABLE households ADD COLUMN pulses_per_liter REAL NOT NULL DEFAULT 450");
  }
  if (!householdColumns.includes("device_last_seen")) {
    db.exec("ALTER TABLE households ADD COLUMN device_last_seen TEXT");
  }

  const readingColumns = db.prepare("PRAGMA table_info(readings)").all().map((c) => c.name);
  if (!readingColumns.includes("pulses")) {
    db.exec("ALTER TABLE readings ADD COLUMN pulses INTEGER");
  }
  if (!readingColumns.includes("source")) {
    db.exec("ALTER TABLE readings ADD COLUMN source TEXT NOT NULL DEFAULT 'device'");
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_households_device_key ON households(device_key) WHERE device_key IS NOT NULL");

  const adminColumns = db.prepare("PRAGMA table_info(admin_accounts)").all().map((c) => c.name);
  if (!adminColumns.includes("reset_code_hash")) {
    db.exec("ALTER TABLE admin_accounts ADD COLUMN reset_code_hash TEXT");
  }
  if (!adminColumns.includes("reset_code_expires")) {
    db.exec("ALTER TABLE admin_accounts ADD COLUMN reset_code_expires TEXT");
  }
  if (!adminColumns.includes("role")) {
    // Existing admins predate roles — treat them all as full-access officers.
    db.exec("ALTER TABLE admin_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'officer'");
  }
}

// Seed data that must exist even on databases created before these features
// were added. Idempotent: safe to run on every boot.
function ensureSeedExtras() {
  // A demo collector account so the two roles can be tried out immediately.
  const collectorExists = db
    .prepare("SELECT 1 FROM admin_accounts WHERE email = ?")
    .get("collector@barangay.local");
  if (!collectorExists) {
    db.prepare(
      "INSERT INTO admin_accounts (email, password_hash, role) VALUES (?, ?, 'collector')"
    ).run("collector@barangay.local", bcrypt.hashSync("collector123", 10));
  }

  // Default announcements, so existing installs don't show an empty list after
  // the resident view starts reading them from the database.
  const count = db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n;
  if (count === 0) {
    const insert = db.prepare(
      "INSERT INTO announcements (type, title, tag, content, published_date) VALUES (@type, @title, @tag, @content, @published_date)"
    );
    const defaults = [
      { type: "info", title: "Scheduled Maintenance – Water Interruption", tag: "Maintenance", published_date: "2026-06-25", content: "There will be a scheduled water interruption on June 28, 2026 (Saturday) from 8:00 AM to 5:00 PM to allow for pipeline maintenance in Purok 3 and Purok 5. Please store enough water for your household's needs. We apologize for any inconvenience." },
      { type: "success", title: "New Online Payment Now Available", tag: "Service Update", published_date: "2026-06-15", content: "Residents can now pay their water bills online using GCash directly through this portal. Go to Payment History and click 'Pay Now' to settle your current balance. No need to visit the barangay office." },
      { type: "warn", title: "Water Conservation Advisory", tag: "Advisory", published_date: "2026-06-10", content: "Due to the current dry season, we encourage all households to conserve water usage. Limit watering of plants and car washing during peak hours (6 AM – 9 AM and 5 PM – 8 PM). Households exceeding 50 CM³ per cycle may be flagged for inspection." },
      { type: "info", title: "New IoT Flow Sensors Installed", tag: "Technology", published_date: "2026-05-30", content: "Barangay Kinamlutan has successfully installed IoT-based water flow sensors for all connected households. These sensors automatically track your consumption and detect unusual flow patterns that may indicate leaks. Your readings are updated in real time on this portal." },
    ];
    const seedAll = db.transaction((rows) => rows.forEach((r) => insert.run(r)));
    seedAll(defaults);
  }

  const residentAccountColumns = db.prepare("PRAGMA table_info(resident_accounts)").all().map((c) => c.name);
  if (!residentAccountColumns.includes("reset_code_hash")) {
    db.exec("ALTER TABLE resident_accounts ADD COLUMN reset_code_hash TEXT");
  }
  if (!residentAccountColumns.includes("reset_code_expires")) {
    db.exec("ALTER TABLE resident_accounts ADD COLUMN reset_code_expires TEXT");
  }
  if (!residentAccountColumns.includes("username")) {
    db.exec("ALTER TABLE resident_accounts ADD COLUMN username TEXT");
  }
}

initSchema();
ensureSeedExtras();

module.exports = { db, isNewDb };