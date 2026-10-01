const crypto = require("crypto");
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { db } = require("../db/database");
const { authMiddleware } = require("../utils/auth");
const { deviceAuthMiddleware } = require("../utils/deviceAuth");
const { recordAudit } = require("../utils/audit");
const events = require("../utils/events");
const alerts = require("../utils/alerts");
const { getAlertSettings } = require("../utils/settings");
const { computeLeakStreakMinutes, classifyRealTimeFlow, toMs } = require("../utils/flowDetection");

const router = express.Router();

// ───────────────────────────────────────────────────────────
// Real-time flow anomaly detection
//
// This runs on every ingested reading (every few seconds), independent of
// detectAbnormalConsumption in routes/data.js (which only runs once per
// billing cycle, comparing a whole month's usage to history). A live pulse
// sensor lets us catch things a monthly meter can't: a tap left open right
// now, or a slow leak that's been running continuously overnight.
//
// Thresholds live in app_settings (utils/settings.js), editable from the
// admin Settings page — read fresh here on every check.
// ───────────────────────────────────────────────────────────
function checkRealTimeFlow(householdId, flowRateLpm) {
  const settings = getAlertSettings();

  // Walk back through recent *device* readings while flow has stayed
  // continuously at/above the leak threshold — source = 'device' excludes
  // seed/mock/manual rows from the streak.
  const recent = db
    .prepare(
      `SELECT flow_rate, recorded_at FROM readings
       WHERE household_id = ? AND source = 'device'
       ORDER BY recorded_at DESC LIMIT 60`
    )
    .all(householdId);
  const streakMinutes = computeLeakStreakMinutes(recent, settings, Date.now());

  const types = classifyRealTimeFlow(flowRateLpm, streakMinutes, settings);

  if (types.includes("High Flow") && !alerts.hasRecentUnresolvedAlert(householdId, "High Flow", settings.alertThrottleMinutes)) {
    alerts.createAlert(householdId, "High Flow", `${flowRateLpm.toFixed(1)} L/min`, `${settings.highFlowLpm} L/min`);
  }

  if (types.includes("Leak Detected") && !alerts.hasRecentUnresolvedAlert(householdId, "Leak Detected", settings.alertThrottleMinutes)) {
    alerts.createAlert(
      householdId,
      "Leak Detected",
      `${flowRateLpm.toFixed(1)} L/min`,
      `${settings.leakFlowLpm} L/min sustained ${settings.leakSustainedMinutes}+ min`
    );
  }
}

// ───────────────────────────────────────────────────────────
// Sensor-silence detection — a device that's stopped reporting entirely is
// its own kind of problem (dead battery, lost Wi-Fi, physically tampered
// with) and is invisible to checkRealTimeFlow above, which only ever runs
// when a reading *does* arrive. This sweeps all provisioned households on an
// interval (see startDeviceSilenceMonitor) instead.
// ───────────────────────────────────────────────────────────
function checkDeviceSilence() {
  const settings = getAlertSettings();
  const provisioned = db
    .prepare(`SELECT id, device_last_seen FROM households WHERE device_key IS NOT NULL AND device_last_seen IS NOT NULL`)
    .all();

  const now = Date.now();
  for (const h of provisioned) {
    const minutesSince = (now - toMs(h.device_last_seen)) / 60000;
    if (minutesSince >= settings.deviceSilenceMinutes && !alerts.hasUnresolvedAlertOfType(h.id, "No Sensor Data")) {
      alerts.createAlert(
        h.id,
        "No Sensor Data",
        `Last seen ${Math.round(minutesSince)} min ago`,
        `${settings.deviceSilenceMinutes} min silence`
      );
    }
  }
}

let silenceMonitorHandle = null;

// Starts the periodic sweep. Not run at module load — index.js calls this
// explicitly once on boot, so requiring this router (e.g. from a test) never
// has the side effect of scheduling a background timer.
function startDeviceSilenceMonitor(intervalMs = 2 * 60 * 1000) {
  if (silenceMonitorHandle) return silenceMonitorHandle;
  checkDeviceSilence(); // catch anything that went silent while the server was down
  silenceMonitorHandle = setInterval(checkDeviceSilence, intervalMs);
  silenceMonitorHandle.unref?.(); // don't keep the process alive on this alone
  return silenceMonitorHandle;
}

function stopDeviceSilenceMonitor() {
  if (silenceMonitorHandle) clearInterval(silenceMonitorHandle);
  silenceMonitorHandle = null;
}

// ───────────────────────────────────────────────────────────
// Device ingestion — called by the ESP8266/ESP32 firmware
// ───────────────────────────────────────────────────────────

// A device that's misconfigured (e.g. stuck in a fast loop) shouldn't be
// able to flood the DB or the SSE stream. One reading roughly every second,
// per device key, is already far more frequent than useful.
const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers["x-device-key"] || ipKeyGenerator(req.ip),
  message: { error: "Too many readings submitted. Slow down the reporting interval." },
});

// POST /api/devices/readings — device sends raw pulse count + the time
// window it was counted over; the server (not the firmware) does the
// liters/flow-rate math using the household's calibration factor, so a
// miscalibration can be fixed from the admin panel without reflashing
// hardware. Body: { pulses: <int >= 0>, intervalMs: <int > 0> }
router.post("/devices/readings", deviceLimiter, deviceAuthMiddleware, (req, res) => {
  const { pulses, intervalMs } = req.body || {};

  if (!Number.isInteger(pulses) || pulses < 0) {
    return res.status(400).json({ error: "pulses must be a non-negative integer." });
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 10 * 60 * 1000) {
    return res.status(400).json({ error: "intervalMs must be a positive number up to 600000 (10 minutes)." });
  }

  const household = req.household;
  const pulsesPerLiter = household.pulses_per_liter || 450;
  const liters = pulses / pulsesPerLiter;
  const flowRateLpm = +((liters / (intervalMs / 60000)) || 0).toFixed(2);
  const settings = getAlertSettings();

  const latest = db
    .prepare("SELECT cm3 FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1")
    .get(household.id);
  const latestBill = db
    .prepare("SELECT curr_cm3 FROM bills WHERE household_id = ? ORDER BY id DESC LIMIT 1")
    .get(household.id);
  const baseCm3 = latest ? latest.cm3 : latestBill ? latestBill.curr_cm3 : 0;
  const newCm3 = +(baseCm3 + liters / 1000).toFixed(4);

  const flowType = flowRateLpm >= settings.highFlowLpm ? "High flow" : "Normal";

  // Computed once and reused for the row, the household's last-seen stamp,
  // and the broadcast payload, in SQLite's own "YYYY-MM-DD HH:MM:SS" (UTC,
  // no "Z") format — the same format every other recorded_at/created_at in
  // this app is stored and parsed as. Using a JS ISO string (with "Z" and
  // millisecond precision) here instead would silently fail to parse
  // wherever the frontend expects the SQLite shape (e.g. the device
  // online/offline badge), and a fresh `datetime('now')` per statement could
  // also drift a second apart across the two writes below.
  const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");

  db.prepare(
    `INSERT INTO readings (household_id, cm3, flow_rate, flow_type, pulses, source, recorded_at) VALUES (?, ?, ?, ?, ?, 'device', ?)`
  ).run(household.id, newCm3, flowRateLpm, flowType, pulses, nowSql);

  db.prepare("UPDATE households SET device_last_seen = ? WHERE id = ?").run(nowSql, household.id);

  // This reading is proof the device is back — clear any stale "gone quiet"
  // alert instead of leaving it open for an admin to notice and resolve by
  // hand once the device recovers on its own.
  alerts.autoResolve(household.id, "No Sensor Data");

  if (flowRateLpm > 0) {
    checkRealTimeFlow(household.id, flowRateLpm);
  }

  events.broadcast("reading", {
    householdId: household.id,
    cm3: newCm3,
    flowRate: flowRateLpm,
    flowType,
    pulses,
    recordedAt: nowSql,
  });

  res.json({ success: true, cm3: newCm3, flowRateLpm, litersThisInterval: +liters.toFixed(3) });
});

// ───────────────────────────────────────────────────────────
// Admin device provisioning
// ───────────────────────────────────────────────────────────

// GET /api/households/:id/device  (admin) — current provisioning status.
// Never returns the key itself here (only right after it's (re)generated,
// same "shown once" pattern as most API-key UIs) — this endpoint is for
// status display (connected? calibration? last seen?).
router.get("/households/:id/device", authMiddleware("admin"), (req, res) => {
  const household = db
    .prepare("SELECT id, device_key, pulses_per_liter, device_last_seen FROM households WHERE id = ?")
    .get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  res.json({
    householdId: household.id,
    provisioned: Boolean(household.device_key),
    pulsesPerLiter: household.pulses_per_liter,
    lastSeen: household.device_last_seen,
  });
});

// POST /api/households/:id/device/provision  (admin, officer only) —
// generates a new device key. Returns the plaintext key once; the admin
// copies it into the firmware's config (see firmware/README.md). Calling
// this again rotates the key, immediately invalidating the old one.
router.post("/households/:id/device/provision", authMiddleware("admin", ["officer"]), (req, res) => {
  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  const key = "dev_" + crypto.randomBytes(24).toString("hex");
  db.prepare("UPDATE households SET device_key = ? WHERE id = ?").run(key, req.params.id);

  recordAudit(req, "device.provision", req.params.id, `Generated a new device key for ${req.params.id}`);
  res.json({ success: true, deviceKey: key });
});

// POST /api/households/:id/device/revoke  (admin, officer only) — clears the
// device key so the physical device can no longer submit readings (e.g. it
// was decommissioned or the key leaked).
router.post("/households/:id/device/revoke", authMiddleware("admin", ["officer"]), (req, res) => {
  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  db.prepare("UPDATE households SET device_key = NULL WHERE id = ?").run(req.params.id);
  recordAudit(req, "device.revoke", req.params.id, `Revoked device key for ${req.params.id}`);
  res.json({ success: true });
});

// POST /api/households/:id/device/calibration  (admin, officer only) —
// updates pulses-per-liter without touching the device. Body: { pulsesPerLiter }
router.post("/households/:id/device/calibration", authMiddleware("admin", ["officer"]), (req, res) => {
  const { pulsesPerLiter } = req.body || {};
  if (!Number.isFinite(pulsesPerLiter) || pulsesPerLiter <= 0) {
    return res.status(400).json({ error: "pulsesPerLiter must be a positive number." });
  }

  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(req.params.id);
  if (!household) return res.status(404).json({ error: "Household not found." });

  db.prepare("UPDATE households SET pulses_per_liter = ? WHERE id = ?").run(pulsesPerLiter, req.params.id);
  recordAudit(req, "device.calibrate", req.params.id, `Set pulses-per-liter to ${pulsesPerLiter} for ${req.params.id}`);
  res.json({ success: true });
});

// Attached to the router export (rather than a separate module) so index.js
// only needs one require for both the routes and the background monitor;
// checkDeviceSilence is exposed too so it can be unit tested directly.
router.startDeviceSilenceMonitor = startDeviceSilenceMonitor;
router.stopDeviceSilenceMonitor = stopDeviceSilenceMonitor;
router.checkDeviceSilence = checkDeviceSilence;

module.exports = router;
