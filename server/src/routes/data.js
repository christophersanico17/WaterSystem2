const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db/database");
const { authMiddleware, optionalAuth } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");
const paymongo = require("../utils/paymongo");
const alerts = require("../utils/alerts");
const { getAlertSettings } = require("../utils/settings");
const { classifyConsumptionRatio } = require("../utils/flowDetection");

const router = express.Router();
const QR_PAYMENT_REF_PREFIX = "QR:";

// ───────────────────────────────────────────────────────────
// Time sync endpoint for ESP32 devices
// ───────────────────────────────────────────────────────────
// GET /api/time — returns current server time (UTC unix timestamp)
// Used by ESP32 devices to sync their RTC clocks for accurate reading timestamps
router.get("/time", (req, res) => {
  const timestamp = Math.floor(Date.now() / 1000);
  res.json({ timestamp });
});

// ───────────────────────────────────────────────────────────
// Residents / households
// ───────────────────────────────────────────────────────────

// GET /api/residents — households, scoped to who's asking:
//   admin    -> every household, full detail (dashboard needs the whole book)
//   resident -> only their OWN household, full detail
//   anonymous -> every household, but ONLY id/name/standpost/meter — just
//                enough for the resident login screen's household picker,
//                with no address/phone/email/device status attached. This
//                endpoint used to return full detail for every household to
//                anyone with no auth at all — that's the bug being fixed
//                here: a household's private info must never be visible to
//                a caller who isn't that household's own resident (or an
//                admin).
router.get("/residents", (req, res) => {
  const user = optionalAuth(req);
  const rows = db.prepare("SELECT * FROM households ORDER BY id").all();

  if (user && user.role === "admin") {
    return res.json(rows.map((h) => residentRow(h)));
  }

  if (user && user.role === "resident") {
    const own = rows.filter((h) => h.id === user.householdId);
    return res.json(own.map((h) => residentRow(h)));
  }

  // Anonymous: just enough for the resident login screen's household picker.
  return res.json(rows.map((h) => ({
    resident_id: h.id,
    name: h.name,
    standpost: h.standpost,
    meter_no: h.meter,
  })));
});

function residentRow(h) {
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
    password_reset_requested: Boolean(
      db.prepare("SELECT 1 FROM password_reset_requests WHERE household_id = ? AND status = 'Pending'").get(h.id)
    ),
    // Device status only — never the device_key itself.
    device_provisioned: Boolean(h.device_key),
    device_last_seen: h.device_last_seen,
    pulses_per_liter: h.pulses_per_liter,
  };
}

// GET /api/residents/:id — single household's full detail. Admin can fetch
// any household; a resident may only fetch their own.
router.get("/residents/:id", authMiddleware(), (req, res) => {
  if (req.user.role !== "admin" && req.user.householdId !== req.params.id) {
    return res.status(403).json({ error: "You can only view your own household." });
  }
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

// PATCH /api/residents/:id — a resident updates their own contact info and,
// optionally, their password. Changing the password requires the current
// one, same as the admin "My Account" flow — otherwise a hijacked, still
// logged-in session could silently lock the real owner out.
router.patch("/residents/:id", authMiddleware("resident"), (req, res) => {
  if (req.user.householdId !== req.params.id) {
    return res.status(403).json({ error: "You can only update your own household." });
  }
  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  const { name, address, phone, email, currentPassword, newPassword } = req.body || {};

  if (newPassword) {
    const account = db.prepare("SELECT password_hash FROM resident_accounts WHERE household_id = ?").get(req.params.id);
    if (!account || !account.password_hash || !currentPassword || !bcrypt.compareSync(currentPassword, account.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE resident_accounts SET password_hash = ?, updated_at = datetime('now') WHERE household_id = ?").run(hash, req.params.id);
  }

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

// POST /api/residents/:id/reset-password  (admin only)
// Body: { newPassword? }
// With newPassword: sets it directly and resolves any pending forgot-password
// request for this household — the admin-confirmed flow that replaces email/SMS
// verification codes entirely. Without it: clears the password so the resident
// gets the "create a new password" flow on next login (unchanged behavior for
// admin-initiated resets that aren't tied to a resident's request).
router.post("/residents/:id/reset-password", authMiddleware("admin", ["officer"]), (req, res) => {
  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  const { newPassword } = req.body || {};

  if (newPassword) {
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    const account = db.prepare("SELECT household_id FROM resident_accounts WHERE household_id = ?").get(req.params.id);
    if (account) {
      db.prepare("UPDATE resident_accounts SET password_hash = ?, updated_at = datetime('now') WHERE household_id = ?").run(hash, req.params.id);
    } else {
      db.prepare("INSERT INTO resident_accounts (household_id, password_hash) VALUES (?, ?)").run(req.params.id, hash);
    }
    db.prepare(
      "UPDATE password_reset_requests SET status = 'Resolved', resolved_at = datetime('now'), resolved_by = ? WHERE household_id = ? AND status = 'Pending'"
    ).run(req.user.email || req.user.name || "admin", req.params.id);

    recordAudit(req, "resident.password_reset_confirmed", req.params.id, `Set and confirmed a new password for ${req.params.id}`);
    return res.json({ success: true });
  }

  db.prepare(
    "UPDATE resident_accounts SET password_hash = NULL, updated_at = datetime('now') WHERE household_id = ?"
  ).run(req.params.id);

  recordAudit(req, "resident.reset_password", req.params.id, `Reset login password for ${req.params.id}`);
  res.json({ success: true });
});

// ───────────────────────────────────────────────────────────
// Bills — tiered pricing based on consumption
// ───────────────────────────────────────────────────────────

const BILLING_TIERS = [
  { maxCm3: 50, ratePeso: 18 },    // 0-50 CM³: ₱18/CM³ (basic/essential)
  { maxCm3: 100, ratePeso: 22 },   // 51-100 CM³: ₱22/CM³ (normal)
  { maxCm3: Infinity, ratePeso: 25 } // 100+ CM³: ₱25/CM³ (excessive)
];
const MIN_BILL = 150;
const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function computeBillAmount(consumptionCm3) {
  let amount = 0;
  let remaining = consumptionCm3;
  let prevMax = 0;

  for (const tier of BILLING_TIERS) {
    if (remaining <= 0) break;
    const tierConsumption = Math.min(remaining, tier.maxCm3 - prevMax);
    amount += tierConsumption * tier.ratePeso;
    remaining -= tierConsumption;
    prevMax = tier.maxCm3;
  }

  return +Math.max(amount, MIN_BILL).toFixed(2);
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

// Abnormal Consumption Detection: compares a newly billed cycle's consumption
// against the household's own historical average (same signal as the resident-facing
// getConsumptionStatus in src/data.js) and logs a real alert when it's anomalous,
// instead of leaving the Alerts page fed only by static seed data. Thresholds
// are shared with the real-time detector in routes/devices.js via
// utils/settings.js, editable from the admin Settings page.
function detectAbnormalConsumption(householdId, consumption, priorBills) {
  const settings = getAlertSettings();
  const pastUsages = priorBills.map((b) => b.curr_cm3 - b.prev_cm3);
  if (pastUsages.length === 0) return;
  const avg = pastUsages.reduce((s, v) => s + v, 0) / pastUsages.length;

  const type = classifyConsumptionRatio(consumption, avg, settings);
  if (!type) return;

  alerts.createAlert(
    householdId,
    type,
    `${consumption} CM3/cycle`,
    `${Math.round(avg * settings.highUsageRatio)} CM3/cycle`
  );
}

// POST /api/bills/generate  (admin only) — generate one bill per household for
// a given period, from each household's latest reading vs. their latest bill.
// Deletes and regenerates to ensure correct tiered pricing is applied.
router.post("/bills/generate", authMiddleware("admin", ["officer"]), (req, res) => {
  const { period, force } = req.body || {};
  if (!period || !dueDateForPeriod(period)) {
    return res.status(400).json({ error: "A valid period (e.g. 'Jun 2026') is required." });
  }

  const households = db.prepare("SELECT id FROM households ORDER BY id").all();
  const insertBill = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due, payment_status, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Unpaid', ?)`
  );

  let created = 0;
  let updated = 0;

  const tx = db.transaction(() => {
    // If force=true, delete existing bills for this period and regenerate with new pricing
    if (force) {
      db.prepare("DELETE FROM bills WHERE period = ?").run(period);
    }

    for (const h of households) {
      const existing = db
        .prepare("SELECT id, amount FROM bills WHERE household_id = ? AND period = ?")
        .get(h.id, period);

      const latestBill = db
        .prepare("SELECT * FROM bills WHERE household_id = ? AND period != ? ORDER BY id DESC LIMIT 1")
        .get(h.id, period);
      const latestReading = db
        .prepare("SELECT * FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1")
        .get(h.id);

      const prevCm3 = latestBill ? latestBill.curr_cm3 : 0;
      const currCm3 = latestReading ? latestReading.cm3 : prevCm3;
      const consumption = Math.max(currCm3 - prevCm3, 0);
      const amount = computeBillAmount(consumption);
      const prevBalance = latestBill && latestBill.payment_status !== "Paid" ? latestBill.total_due : 0;
      const totalDue = +(amount + prevBalance).toFixed(2);

      if (existing) {
        // Update with new tiered pricing calculation
        if (existing.amount !== amount) {
          db.prepare("UPDATE bills SET amount = ?, total_due = ? WHERE household_id = ? AND period = ?")
            .run(amount, totalDue, h.id, period);
          updated++;
        }
      } else {
        const priorBills = db
          .prepare("SELECT prev_cm3, curr_cm3 FROM bills WHERE household_id = ? ORDER BY id")
          .all(h.id);

        insertBill.run(h.id, period, prevCm3, currCm3, amount, prevBalance, totalDue, dueDateForPeriod(period));
        detectAbnormalConsumption(h.id, consumption, priorBills);
        created++;
      }
    }
  });
  tx();

  recordAudit(req, "bill.generate", period, `Generated ${created} new bill(s) and updated ${updated} existing bill(s) for ${period} with tiered pricing`);
  res.json({ success: true, period, created, updated, message: "Bills regenerated with tiered pricing" });
});

// GET /api/bills — admin: all bills, optionally filtered by ?householdId=.
// resident: always forced to their OWN household regardless of any
// ?householdId= they pass, since billing amounts/payment status/balances
// are exactly the kind of thing one household must never see about another.
router.get("/bills", authMiddleware(), (req, res) => {
  if (req.user.role === "admin") {
    const { householdId } = req.query;
    const rows = householdId
      ? db.prepare("SELECT * FROM bills WHERE household_id = ? ORDER BY id").all(householdId)
      : db.prepare("SELECT * FROM bills ORDER BY household_id, id").all();
    return res.json(rows);
  }
  const rows = db.prepare("SELECT * FROM bills WHERE household_id = ? ORDER BY id").all(req.user.householdId);
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

// POST /api/bills/fix-prev-readings (admin only) — fix prev_cm3 values and meter readings
router.post("/bills/fix-prev-readings", authMiddleware("admin", ["officer"]), (req, res) => {
  let fixedBills = 0;
  let fixedReadings = 0;

  const tx = db.transaction(() => {
    const households = db.prepare("SELECT id FROM households").all();

    for (const h of households) {
      // Fix bills: set prev_cm3 based on previous bill's curr_cm3
      const bills = db.prepare("SELECT id, curr_cm3, prev_cm3 FROM bills WHERE household_id = ? ORDER BY id").all(h.id);
      for (let i = 0; i < bills.length; i++) {
        const bill = bills[i];
        const expectedPrevCm3 = i === 0 ? 0 : bills[i - 1].curr_cm3;
        if (bill.prev_cm3 !== expectedPrevCm3) {
          db.prepare("UPDATE bills SET prev_cm3 = ? WHERE id = ?").run(expectedPrevCm3, bill.id);
          fixedBills++;
        }
      }

      // Fix readings: ensure latest reading >= latest bill's curr_cm3
      const latestBill = db.prepare("SELECT curr_cm3 FROM bills WHERE household_id = ? ORDER BY id DESC LIMIT 1").get(h.id);
      const latestReading = db.prepare("SELECT id, cm3 FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1").get(h.id);

      if (latestBill && latestReading) {
        if (latestReading.cm3 < latestBill.curr_cm3) {
          const newCm3 = latestBill.curr_cm3 + 10;
          db.prepare("UPDATE readings SET cm3 = ? WHERE id = ?").run(newCm3, latestReading.id);
          fixedReadings++;
        }
      }
    }
  });
  tx();

  recordAudit(req, "bill.fix_prev_readings", "all", `Fixed ${fixedBills} bill(s) and ${fixedReadings} reading(s)`);

  // Regenerate all bills with the corrected readings
  if (fixedReadings > 0) {
    const periods = db.prepare("SELECT DISTINCT period FROM bills ORDER BY id DESC").all();
    let billsRegenerated = 0;

    const billsTx = db.transaction(() => {
      for (const p of periods) {
        const households = db.prepare("SELECT id FROM households").all();
        for (const h of households) {
          const latestBill = db.prepare("SELECT * FROM bills WHERE household_id = ? AND period = ? ORDER BY id DESC LIMIT 1").get(h.id, p.period);
          const latestReading = db.prepare("SELECT cm3 FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1").get(h.id);

          if (latestBill && latestReading) {
            const prevCm3 = latestBill.prev_cm3;
            const currCm3 = latestReading.cm3;
            const consumption = Math.max(currCm3 - prevCm3, 0);
            const amount = computeBillAmount(consumption);
            const totalDue = +(amount + (latestBill.payment_status !== "Paid" ? latestBill.prev_balance : 0)).toFixed(2);

            db.prepare("UPDATE bills SET curr_cm3 = ?, amount = ?, total_due = ? WHERE id = ?")
              .run(currCm3, amount, totalDue, latestBill.id);
            billsRegenerated++;
          }
        }
      }
    });
    billsTx();

    return res.json({ success: true, fixedBills, fixedReadings, billsRegenerated, message: `Fixed ${fixedReadings} readings and regenerated ${billsRegenerated} bills` });
  }

  res.json({ success: true, fixedBills, fixedReadings, message: `Fixed ${fixedBills} bills and ${fixedReadings} readings` });
});

// POST /api/bills/:id/mark-paid  (admin only) — record a payment the admin
// witnessed directly (cash in hand, or a GCash payment verified against the
// transaction record). GCash calls must include its numeric reference.
router.post("/bills/:id/mark-paid", authMiddleware("admin"), (req, res) => {
  const { method = "Offline", reference } = req.body || {};
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (!['Offline', 'GCash'].includes(method)) {
    return res.status(400).json({ error: "Choose Cash or GCash as the payment method." });
  }

  const paymentReference = method === "GCash" && typeof reference === "string" ? reference.trim() : "";
  if (method === "GCash" && !/^[0-9]{1,80}$/.test(paymentReference)) {
    return res.status(400).json({ error: "Enter the numeric GCash transaction reference." });
  }

  db.prepare(
    `UPDATE bills SET payment_status = 'Paid', payment_method = ?, payment_ref = ?, payment_date = datetime('now')
     WHERE id = ?`
  ).run(method, method === "GCash" ? `${QR_PAYMENT_REF_PREFIX}${paymentReference}` : null, req.params.id);

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

// POST /api/bills/:id/gcash/initiate — resident starts a GCash payment.
// Creates a real PayMongo Checkout Session (test mode, unless live keys are
// configured) and returns its hosted checkout_url. The bill is marked
// "GCash Pending" immediately so the UI reflects the in-progress payment,
// but it's only ever flipped to "Paid" once we've verified with PayMongo
// (via /gcash/sync or the webhook) — never just because the client says so.
router.post("/bills/:id/gcash/initiate", authMiddleware("resident"), async (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.household_id !== req.user.householdId) {
    return res.status(403).json({ error: "You can only pay your own bill." });
  }
  if (bill.payment_status === "Paid") {
    return res.status(400).json({ error: "This bill is already paid." });
  }
  if (bill.total_due < 20) {
    return res.status(400).json({ error: "PayMongo requires a minimum amount of ₱20.00." });
  }

  const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

  try {
    const session = await paymongo.createCheckoutSession({
      amountPesos: bill.total_due,
      description: `Water bill — ${bill.household_id} — ${bill.period}`,
      referenceNumber: `BILL-${bill.id}`,
      successUrl: `${frontendOrigin}/resident?paidHousehold=${encodeURIComponent(bill.household_id)}`,
      cancelUrl: `${frontendOrigin}/resident?cancelledHousehold=${encodeURIComponent(bill.household_id)}`,
      metadata: { billId: String(bill.id), householdId: bill.household_id, period: bill.period },
    });

    const sessionId = session?.data?.id;
    const checkoutUrl = session?.data?.attributes?.checkout_url;
    if (!sessionId || !checkoutUrl) {
      throw new Error("PayMongo did not return a checkout session.");
    }

    db.prepare(
      `UPDATE bills SET payment_status = 'GCash Pending', payment_method = 'GCash', payment_ref = ?
       WHERE id = ?`
    ).run(sessionId, req.params.id);

    recordAudit(req, "bill.gcash_initiate", bill.household_id, `Started PayMongo checkout for ${bill.household_id} (${bill.period})`);
    res.json({ success: true, ref: sessionId, checkout_url: checkoutUrl });
  } catch (err) {
    console.error("PayMongo checkout session error:", err.message, err.paymongo || "");
    res.status(502).json({ error: "Could not start PayMongo checkout: " + err.message });
  }
});

// POST /api/bills/:id/gcash/reference — resident submits the GCash receipt
// reference after paying through the displayed QR. An admin verifies it.
router.post("/bills/:id/gcash/reference", authMiddleware("resident"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.household_id !== req.user.householdId) {
    return res.status(403).json({ error: "You can only submit a reference for your own bill." });
  }
  if (bill.payment_status === "Paid") {
    return res.status(400).json({ error: "This bill is already paid." });
  }

  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
  if (!/^[0-9]{1,80}$/.test(reference)) {
    return res.status(400).json({ error: "Enter a numeric GCash payment reference (up to 80 digits)." });
  }

  db.prepare(
    `UPDATE bills SET payment_status = 'GCash Pending', payment_method = 'GCash', payment_ref = ?
     WHERE id = ?`
  ).run(`${QR_PAYMENT_REF_PREFIX}${reference}`, req.params.id);

  recordAudit(req, "bill.gcash_reference_submitted", bill.household_id, `Submitted a GCash QR payment reference for ${bill.household_id} (${bill.period})`);
  res.json({ success: true, status: "GCash Pending" });
});

// Shared by both sync routes below: re-checks one bill against PayMongo and
// marks it Paid if confirmed. `bill` must already be access-checked by the
// caller. Returns the { success, paid, status } payload to send as JSON.
async function syncBillWithPaymongo(req, bill) {
  if (bill.payment_status === "Paid") {
    return { success: true, paid: true, status: "Paid" };
  }
  if (bill.payment_status !== "GCash Pending" || !bill.payment_ref) {
    return { success: true, paid: false, status: bill.payment_status };
  }
  if (bill.payment_ref.startsWith(QR_PAYMENT_REF_PREFIX)) {
    return { success: true, paid: false, status: "GCash Pending" };
  }

  const session = await paymongo.retrieveCheckoutSession(bill.payment_ref);
  const paid = paymongo.isCheckoutSessionPaid(session);
  if (paid) {
    db.prepare(
      `UPDATE bills SET payment_status = 'Paid', payment_date = datetime('now') WHERE id = ?`
    ).run(bill.id);
    recordAudit(req, "bill.gcash_confirmed", bill.household_id, `PayMongo confirmed GCash payment for ${bill.household_id} (${bill.period})`);
  }
  return { success: true, paid, status: paid ? "Paid" : "GCash Pending" };
}

// POST /api/bills/:id/gcash/sync — re-check a pending payment against PayMongo
// and mark the bill Paid if PayMongo confirms it. Callable by the resident
// who owns the bill or by an admin. This is the primary confirmation path in
// environments without a public webhook URL (e.g. local development).
router.post("/bills/:id/gcash/sync", authMiddleware(), async (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });

  const isOwner = req.user.role === "resident" && req.user.householdId === bill.household_id;
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "You do not have access to this bill." });
  }

  try {
    res.json(await syncBillWithPaymongo(req, bill));
  } catch (err) {
    console.error("PayMongo sync error:", err.message, err.paymongo || "");
    res.status(502).json({ error: "Could not check payment status with PayMongo: " + err.message });
  }
});

// POST /api/households/:householdId/gcash/sync — same as above, but resolves
// the household's current bill server-side. Used right after the PayMongo
// checkout redirect, when the frontend only has the household id in the URL
// and may not have the bill data loaded yet.
router.post("/households/:householdId/gcash/sync", authMiddleware(), async (req, res) => {
  const { householdId } = req.params;
  const isOwner = req.user.role === "resident" && req.user.householdId === householdId;
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "You do not have access to this household." });
  }

  const bill = db
    .prepare("SELECT * FROM bills WHERE household_id = ? ORDER BY id DESC LIMIT 1")
    .get(householdId);
  if (!bill) return res.json({ success: true, paid: false, status: "No bill" });

  try {
    res.json(await syncBillWithPaymongo(req, bill));
  } catch (err) {
    console.error("PayMongo sync error:", err.message, err.paymongo || "");
    res.status(502).json({ error: "Could not check payment status with PayMongo: " + err.message });
  }
});

// POST /api/bills/:id/gcash/confirm  (admin only) — manual override to confirm
// a pending GCash payment without waiting on PayMongo (e.g. the resident paid
// but a webhook was missed, or staff confirmed the payment by other means).
// Prefer /gcash/sync where possible since it verifies with PayMongo directly.
router.post("/bills/:id/gcash/confirm", authMiddleware("admin"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.payment_status !== "GCash Pending") {
    return res.status(400).json({ error: "This bill is not pending GCash confirmation." });
  }

  if (bill.payment_ref?.startsWith(QR_PAYMENT_REF_PREFIX)) {
    const submittedReference = bill.payment_ref.slice(QR_PAYMENT_REF_PREFIX.length).trim();
    const verifiedReference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
    if (!/^[0-9]{1,80}$/.test(verifiedReference)) {
      return res.status(400).json({ error: "Enter the numeric reference shown in the GCash transaction record." });
    }
    if (verifiedReference.toUpperCase() !== submittedReference.toUpperCase()) {
      return res.status(400).json({ error: "The verified reference does not match the resident's submitted reference." });
    }
  }

  db.prepare(
    `UPDATE bills SET payment_status = 'Paid', payment_date = datetime('now') WHERE id = ?`
  ).run(req.params.id);

  recordAudit(req, "bill.gcash_confirm", bill.household_id, `Manually confirmed GCash payment for ${bill.household_id} (${bill.period})`);
  res.json({ success: true });
});

// POST /api/bills/:id/cash/initiate — resident declares intent to pay in
// cash at the barangay office. Unlike GCash, there's no third party to
// verify a cash handoff against, so this only ever marks the bill "Cash
// Pending" — it can never flip to "Paid" by itself. An admin who physically
// received the cash must confirm it via /cash/confirm below.
router.post("/bills/:id/cash/initiate", authMiddleware("resident"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.household_id !== req.user.householdId) {
    return res.status(403).json({ error: "You can only pay your own bill." });
  }
  if (bill.payment_status === "Paid") {
    return res.status(400).json({ error: "This bill is already paid." });
  }

  db.prepare(
    `UPDATE bills SET payment_status = 'Cash Pending', payment_method = 'Offline' WHERE id = ?`
  ).run(req.params.id);

  recordAudit(req, "bill.cash_initiate", bill.household_id, `${bill.household_id} declared intent to pay ${bill.period} bill in cash`);
  res.json({ success: true });
});

// POST /api/bills/:id/cash/confirm  (admin only) — the admin who physically
// received the cash confirms it, flipping "Cash Pending" to "Paid". This is
// the only way a Cash Pending bill ever becomes Paid — never automatic.
router.post("/bills/:id/cash/confirm", authMiddleware("admin"), (req, res) => {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id);
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  if (bill.payment_status !== "Cash Pending") {
    return res.status(400).json({ error: "This bill is not pending cash confirmation." });
  }

  db.prepare(
    `UPDATE bills SET payment_status = 'Paid', payment_date = datetime('now') WHERE id = ?`
  ).run(req.params.id);

  recordAudit(req, "bill.cash_confirm", bill.household_id, `Confirmed cash payment for ${bill.household_id} (${bill.period})`);
  res.json({ success: true });
});

// GET /api/payments — payment history, optionally filtered by ?householdId=
// Same admin-sees-all / resident-sees-own-only split as GET /bills above.
router.get("/payments", authMiddleware(), (req, res) => {
  const targetHouseholdId = req.user.role === "admin" ? req.query.householdId : req.user.householdId;
  const rows = targetHouseholdId
    ? db
        .prepare(
          `SELECT id, household_id, period, amount, payment_method, payment_status, payment_date
           FROM bills WHERE household_id = ? AND payment_status != 'Unpaid' ORDER BY id`
        )
        .all(targetHouseholdId)
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

// GET /api/readings?householdId=HH-001 — full reading history for a
// household. Admin may request any household; a resident only their own.
router.get("/readings", authMiddleware(), (req, res) => {
  const { householdId } = req.query;
  if (!householdId) return res.status(400).json({ error: "householdId query param is required." });
  if (req.user.role !== "admin" && req.user.householdId !== householdId) {
    return res.status(403).json({ error: "You can only view your own readings." });
  }
  const rows = db
    .prepare("SELECT * FROM readings WHERE household_id = ? ORDER BY recorded_at DESC")
    .all(householdId);
  res.json(rows);
});

// GET /api/readings/latest/:meterNo — most recent reading for a meter.
// Same ownership rule as above, resolved via the meter's owning household.
router.get("/readings/latest/:meterNo", authMiddleware(), (req, res) => {
  const household = db
    .prepare("SELECT id FROM households WHERE meter = ?")
    .get(req.params.meterNo);
  if (!household) return res.status(404).json({ error: "Meter not found." });
  if (req.user.role !== "admin" && req.user.householdId !== household.id) {
    return res.status(403).json({ error: "You can only view your own readings." });
  }

  const reading = db
    .prepare(
      "SELECT * FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1"
    )
    .get(household.id);

  if (!reading) return res.status(404).json({ error: "No readings yet for this meter." });
  res.json(reading);
});

// POST /api/readings  (admin only) — manually record/correct a reading, e.g.
// to back-fill a period before a device was installed, or to note a manual
// meter check. Real-time readings from actual hardware go through the
// authenticated /api/devices/readings endpoint instead (routes/devices.js),
// which is what keeps this one admin-gated: readings feed billing directly,
// so letting anyone post arbitrary consumption data for any household would
// be a real fraud vector once real money and real meters are involved.
router.post("/readings", authMiddleware("admin", ["officer"]), (req, res) => {
  const { householdId, cm3, flowRate, flowType } = req.body || {};

  if (!householdId) {
    return res.status(400).json({ error: "householdId is required." });
  }
  if (typeof cm3 !== "number" || !Number.isFinite(cm3) || cm3 < 0) {
    return res.status(400).json({ error: "cm3 must be a non-negative number." });
  }
  if (flowRate !== undefined && (typeof flowRate !== "number" || !Number.isFinite(flowRate) || flowRate < 0)) {
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
    `INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source) VALUES (?, ?, ?, ?, 'manual')`
  ).run(householdId, cm3, flowRate ?? 0, flowType || "Normal");

  recordAudit(req, "reading.manual_entry", householdId, `Manually recorded a ${cm3} CM³ reading for ${householdId}`);
  res.json({ success: true });
});

// ───────────────────────────────────────────────────────────
// Alerts
// ───────────────────────────────────────────────────────────

// Admin: every household's alerts. Resident: only their own (same data
// /alerts/mine below already serves — this just keeps the shared frontend
// loader that both portals call from ever seeing anyone else's).
router.get("/alerts", authMiddleware(), (req, res) => {
  if (req.user.role === "admin") {
    const rows = db
      .prepare(
        `SELECT a.*, h.name, h.standpost
         FROM alerts a JOIN households h ON h.id = a.household_id
         ORDER BY a.created_at DESC`
      )
      .all();
    return res.json(rows);
  }
  const rows = db
    .prepare(
      `SELECT a.*, h.name, h.standpost
       FROM alerts a JOIN households h ON h.id = a.household_id
       WHERE a.household_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(req.user.householdId);
  res.json(rows);
});

// GET /api/alerts/mine  (resident) — this household's own leak/high-flow/
// no-sensor-data alerts, so a resident can see the same real-time detection
// admins see instead of only the per-cycle "High usage" banner on their
// dashboard (which only updates once a bill is generated).
router.get("/alerts/mine", authMiddleware("resident"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, h.name, h.standpost
       FROM alerts a JOIN households h ON h.id = a.household_id
       WHERE a.household_id = ?
       ORDER BY a.created_at DESC LIMIT 20`
    )
    .all(req.user.householdId);
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