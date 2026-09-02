const express = require("express");
const { db } = require("../db/database");
const { authMiddleware } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");

const router = express.Router();

// ───────────────────────────────────────────────────────────
// Residents / households
// ───────────────────────────────────────────────────────────

// GET /api/residents — list all households (admin) or pull a list for the login dropdown (public, minimal fields)
router.get("/residents", (req, res) => {
  const rows = db.prepare("SELECT * FROM households ORDER BY id").all();
  const residents = rows.map((h) => {
    const account = db
      .prepare("SELECT password_hash, google_email FROM resident_accounts WHERE household_id = ?")
      .get(h.id);
    return {
      resident_id: h.id,
      name: h.name,
      standpost: h.standpost,
      meter_no: h.meter,
      address: h.address,
      phone: h.phone,
      email: h.email,
      date_connected: h.date_connected,
      has_password: Boolean(account && account.password_hash),
      google_email: account ? account.google_email : null,
    };
  });
  res.json(residents);
});

// GET /api/residents/:id — single household detail
router.get("/residents/:id", (req, res) => {
  const h = db.prepare("SELECT * FROM households WHERE id = ?").get(req.params.id);
  if (!h) return res.status(404).json({ error: "Household not found." });
  res.json(h);
});

function nextHouseholdId() {
  const rows = db.prepare("SELECT id FROM households").all();
  let maxNum = 0;
  for (const r of rows) {
    const match = /^HH-(\d+)$/.exec(r.id);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `HH-${String(maxNum + 1).padStart(3, "0")}`;
}

// POST /api/residents  (admin only) — connect a new household
router.post("/residents", authMiddleware("admin", ["officer"]), (req, res) => {
  const { name, standpost, meter, address, phone, email, dateConnected } = req.body || {};

  if (!name || !standpost || !meter) {
    return res.status(400).json({ error: "Name, standpost, and meter number are required." });
  }
  const standpostNum = Number(standpost);
  if (!Number.isFinite(standpostNum) || standpostNum <= 0) {
    return res.status(400).json({ error: "Standpost must be a positive number." });
  }

  const meterTaken = db.prepare("SELECT id FROM households WHERE meter = ?").get(meter);
  if (meterTaken) {
    return res.status(400).json({ error: "A household with this meter number already exists." });
  }

  const id = nextHouseholdId();
  db.prepare(
    `INSERT INTO households (id, name, standpost, meter, address, phone, email, date_connected)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')))`
  ).run(id, name, standpostNum, meter, address || null, phone || null, email || null, dateConnected || null);

  recordAudit(req, "household.create", id, `Connected household ${id} — ${name}`);
  res.json({ success: true, id });
});

// PATCH /api/residents/:id — a resident updates their own contact info
router.patch("/residents/:id", authMiddleware("resident"), (req, res) => {
  if (req.user.householdId !== req.params.id) {
    return res.status(403).json({ error: "You can only update your own household." });
  }
  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  const { name, address, phone, email } = req.body || {};
  db.prepare(
    `UPDATE households SET
       name = COALESCE(?, name),
       address = COALESCE(?, address),
       phone = COALESCE(?, phone),
       email = COALESCE(?, email)
     WHERE id = ?`
  ).run(name ?? null, address ?? null, phone ?? null, email ?? null, req.params.id);

  res.json({ success: true });
});

// POST /api/residents/:id/reset-password  (admin only) — clears the resident's
// password so they get the "create a new password" flow on next login.
router.post("/residents/:id/reset-password", authMiddleware("admin", ["officer"]), (req, res) => {
  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  db.prepare(
    "UPDATE resident_accounts SET password_hash = NULL, updated_at = datetime('now') WHERE household_id = ?"
  ).run(req.params.id);

  recordAudit(req, "resident.reset_password", req.params.id, `Reset login password for ${req.params.id}`);
  res.json({ success: true });
});

// ───────────────────────────────────────────────────────────
// Bills
// ───────────────────────────────────────────────────────────

const RATE_PER_CM3 = 20;
const MIN_BILL = 200;
const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function computeBillAmount(consumptionCm3) {
  return +Math.max(consumptionCm3 * RATE_PER_CM3, MIN_BILL).toFixed(2);
}

// Built as a plain "YYYY-MM-DD" string with no Date/toISOString round-trip —
// that round-trip converts through UTC and can shift the day by one
// depending on the server's local timezone.
function dueDateForPeriod(period) {
  const [month, year] = period.split(" ");
  const monthIndex = MONTH_SHORT_NAMES.indexOf(month);
  if (monthIndex === -1 || !year) return null;
  let dueMonth = monthIndex + 1;
  let dueYear = Number(year);
  if (dueMonth > 11) {
    dueMonth = 0;
    dueYear += 1;
  }
  return `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}-09`;
}

function nextAlertId() {
  const rows = db.prepare("SELECT id FROM alerts").all();
  let maxNum = 0;
  for (const r of rows) {
    const match = /^ALT-(\d+)$/.exec(r.id);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `ALT-${maxNum + 1}`;
}

// Abnormal Consumption Detection: compares a newly billed cycle's consumption
// against the household's own historical average (same signal as the resident-facing
// getConsumptionStatus in src/data.js) and logs a real alert when it's anomalous,
// instead of leaving the Alerts page fed only by static seed data.
const HIGH_USAGE_RATIO = 1.6;
const LEAK_USAGE_RATIO = 2.2;
const insertAlert = db.prepare(
  `INSERT INTO alerts (id, household_id, type, flow_rate, threshold, status) VALUES (?, ?, ?, ?, ?, 'Unresolved')`
);

function detectAbnormalConsumption(householdId, consumption, priorBills) {
  const pastUsages = priorBills.map((b) => b.curr_cm3 - b.prev_cm3);
  if (pastUsages.length === 0) return;
  const avg = pastUsages.reduce((s, v) => s + v, 0) / pastUsages.length;
  if (avg <= 0) return;
  const ratio = consumption / avg;
  if (ratio < HIGH_USAGE_RATIO) return;

  const type = ratio >= LEAK_USAGE_RATIO ? "Leak Detected" : "High Flow";
  insertAlert.run(
    nextAlertId(),
    householdId,
    type,
    `${consumption} CM3/cycle`,
    `${Math.round(avg * HIGH_USAGE_RATIO)} CM3/cycle`
  );
}

// POST /api/bills/generate  (admin only) — generate one bill per household for
// a given period, from each household's latest reading vs. their latest bill.
// Households that already have a bill for this period are skipped (idempotent).
router.post("/bills/generate", authMiddleware("admin", ["officer"]), (req, res) => {
  const { period } = req.body || {};
  if (!period || !dueDateForPeriod(period)) {
    return res.status(400).json({ error: "A valid period (e.g. 'Jun 2026') is required." });
  }

  const households = db.prepare("SELECT id FROM households ORDER BY id").all();
  const insertBill = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due, payment_status, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Unpaid', ?)`
  );

  let created = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const h of households) {
      const existing = db
        .prepare("SELECT id FROM bills WHERE household_id = ? AND period = ?")
        .get(h.id, period);
      if (existing) {
        skipped++;
        continue;
      }

      const latestBill = db
        .prepare("SELECT * FROM bills WHERE household_id = ? ORDER BY id DESC LIMIT 1")
        .get(h.id);
      const latestReading = db
        .prepare("SELECT * FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1")
        .get(h.id);

      const prevCm3 = latestBill ? latestBill.curr_cm3 : 0;
      const currCm3 = latestReading ? latestReading.cm3 : prevCm3;
      const consumption = Math.max(currCm3 - prevCm3, 0);
      const amount = computeBillAmount(consumption);
      const prevBalance = latestBill && latestBill.payment_status !== "Paid" ? latestBill.total_due : 0;
      const totalDue = +(amount + prevBalance).toFixed(2);

      const priorBills = db
        .prepare("SELECT prev_cm3, curr_cm3 FROM bills WHERE household_id = ? ORDER BY id")
        .all(h.id);

      insertBill.run(h.id, period, prevCm3, currCm3, amount, prevBalance, totalDue, dueDateForPeriod(period));
      detectAbnormalConsumption(h.id, consumption, priorBills);
      created++;
    }
  });
  tx();

  recordAudit(req, "bill.generate", period, `Generated ${created} bill(s) for ${period}${skipped ? `, skipped ${skipped} already billed` : ""}`);
  res.json({ success: true, period, created, skipped });
});

// GET /api/bills — all bills, optionally filtered by ?householdId=
router.get("/bills", (req, res) => {
  const { householdId } = req.query;
  const rows = householdId
    ? db.prepare("SELECT * FROM bills WHERE household_id = ? ORDER BY id").all(householdId)
    : db.prepare("SELECT * FROM bills ORDER BY household_id, id").all();
  res.json(rows);
});

// GET /api/bills/periods — distinct billing periods available
router.get("/bills/periods", (req, res) => {
  const rows = db
    .prepare("SELECT DISTINCT period FROM bills ORDER BY id DESC")
    .all()
    .map((r) => r.period);
  res.json(rows);
});

// POST /api/bills/:id/mark-paid  (admin only) — record an offline/cash payment
router.post("/bills/:id/mark-paid", authMiddleware("admin"), (req, res) => {
  const { method = "Offline" } = req.body || {};
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });

  db.prepare(
    `UPDATE bills SET payment_status = 'Paid', payment_method = ?, payment_date = datetime('now')
     WHERE id = ?`
  ).run(method, req.params.id);

  recordAudit(req, "bill.mark_paid", bill.household_id, `Marked ${bill.period} bill Paid (${method}) for ${bill.household_id}`);
  res.json({ success: true });
});

// POST /api/bills/:id/mark-unpaid  (admin only) — undo a payment recorded by mistake
router.post("/bills/:id/mark-unpaid", authMiddleware("admin"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });

  db.prepare(
    `UPDATE bills SET payment_status = 'Unpaid', payment_method = NULL, payment_ref = NULL, payment_date = NULL
     WHERE id = ?`
  ).run(req.params.id);

  recordAudit(req, "bill.mark_unpaid", bill.household_id, `Reverted ${bill.period} bill to Unpaid for ${bill.household_id}`);
  res.json({ success: true });
});

// POST /api/bills/:id/gcash/initiate — resident starts a GCash payment (mock: sets to Pending)
router.post("/bills/:id/gcash/initiate", authMiddleware("resident"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.household_id !== req.user.householdId) {
    return res.status(403).json({ error: "You can only pay your own bill." });
  }

  const ref = `GC${Date.now().toString().slice(-8)}`;
  db.prepare(
    `UPDATE bills SET payment_status = 'GCash Pending', payment_method = 'GCash', payment_ref = ?
     WHERE id = ?`
  ).run(ref, req.params.id);

  // In a real integration this would return a PayMongo/GCash checkout_url.
  // Mock mode: frontend just shows the pending state and waits for admin to confirm.
  res.json({ success: true, ref, checkout_url: null });
});

// POST /api/bills/:id/gcash/confirm  (admin only) — confirm a pending GCash payment
router.post("/bills/:id/gcash/confirm", authMiddleware("admin"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.payment_status !== "GCash Pending") {
    return res.status(400).json({ error: "This bill is not pending GCash confirmation." });
  }

  db.prepare(
    `UPDATE bills SET payment_status = 'Paid', payment_date = datetime('now') WHERE id = ?`
  ).run(req.params.id);

  recordAudit(req, "bill.gcash_confirm", bill.household_id, `Confirmed GCash payment for ${bill.household_id} (${bill.period})`);
  res.json({ success: true });
});

// GET /api/payments — payment history, optionally filtered by ?householdId=
router.get("/payments", (req, res) => {
  const { householdId } = req.query;
  const rows = householdId
    ? db
        .prepare(
          `SELECT id, household_id, period, amount, payment_method, payment_status, payment_date
           FROM bills WHERE household_id = ? AND payment_status != 'Unpaid' ORDER BY id`
        )
        .all(householdId)
    : db
        .prepare(
          `SELECT id, household_id, period, amount, payment_method, payment_status, payment_date
           FROM bills WHERE payment_status != 'Unpaid' ORDER BY id`
        )
        .all();
  res.json(rows);
});

// ───────────────────────────────────────────────────────────
// Readings (IoT sensor data)
// ───────────────────────────────────────────────────────────

// GET /api/readings?householdId=HH-001 — full reading history for a household
router.get("/readings", (req, res) => {
  const { householdId } = req.query;
  if (!householdId) return res.status(400).json({ error: "householdId query param is required." });
  const rows = db
    .prepare("SELECT * FROM readings WHERE household_id = ? ORDER BY recorded_at DESC")
    .all(householdId);
  res.json(rows);
});

// GET /api/readings/latest/:meterNo — most recent reading for a meter
router.get("/readings/latest/:meterNo", (req, res) => {
  const household = db
    .prepare("SELECT id FROM households WHERE meter = ?")
    .get(req.params.meterNo);
  if (!household) return res.status(404).json({ error: "Meter not found." });

  const reading = db
    .prepare(
      "SELECT * FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1"
    )
    .get(household.id);

  if (!reading) return res.status(404).json({ error: "No readings yet for this meter." });
  res.json(reading);
});

// POST /api/readings — record a new sensor reading (would be called by IoT device/simulator)
router.post("/readings", (req, res) => {
  const { householdId, cm3, flowRate, flowType } = req.body || {};

  if (!householdId) {
    return res.status(400).json({ error: "householdId is required." });
  }
  if (typeof cm3 !== "number" || !Number.isFinite(cm3) || cm3 < 0) {
    return res.status(400).json({ error: "cm3 must be a non-negative number." });
  }
  if (typeof flowRate !== "number" || !Number.isFinite(flowRate) || flowRate < 0) {
    return res.status(400).json({ error: "flowRate must be a non-negative number." });
  }
  if (flowType !== undefined && !["Normal", "High flow"].includes(flowType)) {
    return res.status(400).json({ error: "flowType must be 'Normal' or 'High flow'." });
  }

  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
  if (!household) return res.status(404).json({ error: "Household not found." });

  const latest = db
    .prepare("SELECT cm3 FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1")
    .get(householdId);
  if (latest && cm3 < latest.cm3) {
    return res.status(400).json({ error: "cm3 cannot be lower than the previous reading." });
  }

  db.prepare(
    `INSERT INTO readings (household_id, cm3, flow_rate, flow_type) VALUES (?, ?, ?, ?)`
  ).run(householdId, cm3, flowRate, flowType || "Normal");

  res.json({ success: true });
});

// ───────────────────────────────────────────────────────────
// Alerts
// ───────────────────────────────────────────────────────────

router.get("/alerts", (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, h.name, h.standpost
       FROM alerts a JOIN households h ON h.id = a.household_id
       ORDER BY a.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.post("/alerts/:id/resolve", authMiddleware("admin", ["officer"]), (req, res) => {
  const result = db
    .prepare("UPDATE alerts SET status = 'Resolved' WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Alert not found." });
  recordAudit(req, "alert.resolve", req.params.id, `Resolved alert ${req.params.id}`);
  res.json({ success: true });
});

// Undo an accidental resolve — moves an alert back to Unresolved.
router.post("/alerts/:id/unresolve", authMiddleware("admin", ["officer"]), (req, res) => {
  const result = db
    .prepare("UPDATE alerts SET status = 'Unresolved' WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Alert not found." });
  recordAudit(req, "alert.unresolve", req.params.id, `Reopened alert ${req.params.id}`);
  res.json({ success: true });
});

// ───────────────────────────────────────────────────────────
// Leak reports
// ───────────────────────────────────────────────────────────

router.post("/leak-reports", authMiddleware("resident"), (req, res) => {
  const { location, description, severity, contactBack } = req.body || {};
  if (!location || !description) {
    return res.status(400).json({ error: "Location and description are required." });
  }
  const id = `LK-${Date.now().toString().slice(-6)}`;
  db.prepare(
    `INSERT INTO leak_reports (id, household_id, location, description, severity, contact_back)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.householdId, location, description, severity || "minor", contactBack ? 1 : 0);

  res.json({ success: true, id });
});

router.get("/leak-reports", authMiddleware("admin", ["officer"]), (req, res) => {
  const rows = db
    .prepare(
      `SELECT lr.*, h.name, h.standpost
       FROM leak_reports lr JOIN households h ON h.id = lr.household_id
       ORDER BY lr.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.post("/leak-reports/:id/resolve", authMiddleware("admin", ["officer"]), (req, res) => {
  const result = db
    .prepare("UPDATE leak_reports SET status = 'Resolved' WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Leak report not found." });
  recordAudit(req, "leak_report.resolve", req.params.id, `Resolved leak report ${req.params.id}`);
  res.json({ success: true });
});

// Undo an accidental resolve — moves a report back to Open.
router.post("/leak-reports/:id/unresolve", authMiddleware("admin", ["officer"]), (req, res) => {
  const result = db
    .prepare("UPDATE leak_reports SET status = 'Open' WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Leak report not found." });
  recordAudit(req, "leak_report.unresolve", req.params.id, `Reopened leak report ${req.params.id}`);
  res.json({ success: true });
});

module.exports = router;