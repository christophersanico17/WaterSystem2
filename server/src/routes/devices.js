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
const { computeLeakStreakMinutes, computeAdaptiveHighFlowLpm, classifyRealTimeFlow, toMs } = require("../utils/flowDetection");

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

// Each household's own High Flow threshold, learned from its recent device
// readings (see computeAdaptiveHighFlowLpm). Readings arrive every ~15s but
// the threshold only needs to follow usage over days, so it's cached per
// household for a few minutes instead of re-scanning two weeks of readings
// on every report. The cache key includes the learning settings, so an admin
// changing them from Settings takes effect on the next reading.
const HIGH_FLOW_CACHE_MS = 5 * 60 * 1000;
const highFlowCache = new Map();

function getHighFlowThreshold(householdId, settings) {
  const settingsKey = [
    settings.highFlowLpm,
    settings.highFlowLearnDays,
    settings.highFlowLearnMultiplier,
    settings.highFlowMinSamples,
    settings.highFlowMaxLpm,
  ].join("|");
  const cached = highFlowCache.get(householdId);
  if (cached && cached.settingsKey === settingsKey && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const rates = db
    .prepare(
      `SELECT flow_rate FROM readings
       WHERE household_id = ? AND source = 'device' AND flow_rate > 0
         AND recorded_at >= datetime('now', ?)`
    )
    .all(householdId, `-${settings.highFlowLearnDays} days`)
    .map((r) => r.flow_rate);
  const result = computeAdaptiveHighFlowLpm(rates, settings);

  highFlowCache.set(householdId, { settingsKey, expiresAt: Date.now() + HIGH_FLOW_CACHE_MS, result });
  return result;
}

function checkRealTimeFlow(householdId, flowRateLpm, settings, highFlowLpm) {

  // Walk back through recent *device* readings while flow has stayed
  // continuously at/above the leak threshold — source = 'device' excludes
  // seed/mock/manual rows from the streak. With 5-second reporting intervals,
  // we need 180 readings for ~15 minutes of history (same as the old 15-second interval).
  const recent = db
    .prepare(
      `SELECT flow_rate, recorded_at FROM readings
       WHERE household_id = ? AND source = 'device'
       ORDER BY recorded_at DESC LIMIT 180`
    )
    .all(householdId);
  const streakMinutes = computeLeakStreakMinutes(recent, settings, Date.now());

  const types = classifyRealTimeFlow(flowRateLpm, streakMinutes, settings, highFlowLpm);

  if (types.includes("High Flow") && !alerts.hasRecentUnresolvedAlert(householdId, "High Flow", settings.alertThrottleMinutes)) {
    alerts.createAlert(householdId, "High Flow", `${flowRateLpm.toFixed(1)} L/min`, `${highFlowLpm} L/min`);
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
// hardware. Body: { pulses: <int >= 0>, intervalMs: <int > 0>, samples?: [<int >= 0>, ...] }
//
// `samples` (optional — older firmware doesn't send it) is the pulses counted
// in each ~1-second slot of the report, oldest first. They're only relayed
// to the live dashboard as per-second liters, not stored: storing every
// second would multiply the readings table by 10 for no billing benefit,
// since `pulses` already carries the total.
router.post("/devices/readings", deviceLimiter, deviceAuthMiddleware, (req, res) => {
  const { pulses, intervalMs, samples } = req.body || {};

  if (!Number.isInteger(pulses) || pulses < 0) {
    return res.status(400).json({ error: "pulses must be a non-negative integer." });
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 10 * 60 * 1000) {
    return res.status(400).json({ error: "intervalMs must be a positive number up to 600000 (10 minutes)." });
  }
  if (
    samples !== undefined &&
    (!Array.isArray(samples) || samples.length > 120 || !samples.every((p) => Number.isInteger(p) && p >= 0))
  ) {
    return res.status(400).json({ error: "samples must be an array of up to 120 non-negative integers." });
  }

  const household = req.household;
  const pulsesPerLiter = household.pulses_per_liter || 450;
  const liters = pulses / pulsesPerLiter;
  const flowRateLpm = +((liters / (intervalMs / 60000)) || 0).toFixed(2);
  const settings = getAlertSettings();

  // Computed once and reused for the row, the household's last-seen stamp,
  // and the broadcast payload, in SQLite's own "YYYY-MM-DD HH:MM:SS" (UTC,
  // no "Z") format — the same format every other recorded_at/created_at in
  // this app is stored and parsed as. Using a JS ISO string (with "Z" and
  // millisecond precision) here instead would silently fail to parse
  // wherever the frontend expects the SQLite shape (e.g. the device
  // online/offline badge), and a fresh `datetime('now')` per statement could
  // also drift a second apart across the two writes below.
  const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");

  // A physically impossible flow rate is a wiring/noise fault, not water:
  // a floating signal pin can fire the interrupt hundreds of thousands of
  // times in a few seconds, which would otherwise be billed as cubic meters
  // of usage. Discard it, but still count the device as alive, and raise a
  // Sensor Fault alert so someone checks the wiring. Answered with 200 so
  // the firmware drops these pulses instead of carrying them into its next
  // report (it retries anything that isn't a 200).
  if (flowRateLpm > settings.maxPlausibleFlowLpm) {
    db.prepare("UPDATE households SET device_last_seen = ? WHERE id = ?").run(nowSql, household.id);
    alerts.autoResolve(household.id, "No Sensor Data");
    if (!alerts.hasUnresolvedAlertOfType(household.id, "Sensor Fault")) {
      alerts.createAlert(
        household.id,
        "Sensor Fault",
        `${flowRateLpm.toFixed(0)} L/min (impossible)`,
        `max ${settings.maxPlausibleFlowLpm} L/min`
      );
    }
    return res.json({
      success: false,
      discarded: true,
      error: `Flow of ${flowRateLpm.toFixed(0)} L/min is above the ${settings.maxPlausibleFlowLpm} L/min maximum — treated as sensor noise, not recorded. Check the sensor wiring.`,
    });
  }

  const latest = db
    .prepare("SELECT cm3 FROM readings WHERE household_id = ? ORDER BY recorded_at DESC LIMIT 1")
    .get(household.id);
  const latestBill = db
    .prepare("SELECT curr_cm3 FROM bills WHERE household_id = ? ORDER BY id DESC LIMIT 1")
    .get(household.id);
  const baseCm3 = latest ? latest.cm3 : latestBill ? latestBill.curr_cm3 : 0;
  const newCm3 = +(baseCm3 + liters / 1000).toFixed(4);

  const highFlow = getHighFlowThreshold(household.id, settings);
  const flowType = flowRateLpm >= highFlow.thresholdLpm ? "High flow" : "Normal";

  db.prepare(
    `INSERT INTO readings (household_id, cm3, flow_rate, flow_type, pulses, source, recorded_at) VALUES (?, ?, ?, ?, ?, 'device', ?)`
  ).run(household.id, newCm3, flowRateLpm, flowType, pulses, nowSql);

  db.prepare("UPDATE households SET device_last_seen = ? WHERE id = ?").run(nowSql, household.id);

  // This reading is proof the device is back — clear any stale "gone quiet"
  // alert instead of leaving it open for an admin to notice and resolve by
  // hand once the device recovers on its own.
  alerts.autoResolve(household.id, "No Sensor Data");

  if (flowRateLpm > 0) {
    checkRealTimeFlow(household.id, flowRateLpm, settings, highFlow.thresholdLpm);
  }

  events.broadcast("reading", {
    householdId: household.id,
    cm3: newCm3,
    flowRate: flowRateLpm,
    flowType,
    pulses,
    perSecondLiters: (samples || []).map((p) => +(p / pulsesPerLiter).toFixed(3)),
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
// status display (connected? calibration? last seen? learned High Flow
// threshold?).
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
    highFlow: getHighFlowThreshold(household.id, getAlertSettings()),
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
