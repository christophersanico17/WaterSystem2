// Shared alert read/write helpers, used by both real-time flow detection
// (routes/devices.js, on every device reading) and billing-cycle abnormal
// consumption detection (routes/data.js, once per bill generation) — so the
// two independent detectors don't each maintain their own copy of "how to
// allocate an alert id" / "how to write + broadcast one".
const { db } = require("../db/database");
const events = require("./events");

const insertAlertStmt = db.prepare(
  `INSERT INTO alerts (id, household_id, type, flow_rate, threshold, status) VALUES (?, ?, ?, ?, ?, 'Unresolved')`
);

function nextAlertId() {
  const rows = db.prepare("SELECT id FROM alerts").all();
  let maxNum = 0;
  for (const r of rows) {
    const match = /^ALT-(\d+)$/.exec(r.id);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `ALT-${maxNum + 1}`;
}

// Was this household already alerted for `type` within the last
// `throttleMinutes`? Used to stop a sustained condition (e.g. a tap left
// running) from writing a fresh alert on every single reading.
function hasRecentUnresolvedAlert(householdId, type, throttleMinutes) {
  const row = db
    .prepare(
      `SELECT 1 FROM alerts WHERE household_id = ? AND type = ? AND status = 'Unresolved'
       AND created_at >= datetime('now', ?) LIMIT 1`
    )
    .get(householdId, type, `-${throttleMinutes} minutes`);
  return Boolean(row);
}

// Is there any open (unresolved) alert of `type` for this household, no
// matter how old? Used for conditions that stay "true" until something else
// clears them (e.g. a device that's gone silent) rather than ones tied to a
// rolling time window.
function hasUnresolvedAlertOfType(householdId, type) {
  const row = db
    .prepare(`SELECT 1 FROM alerts WHERE household_id = ? AND type = ? AND status = 'Unresolved' LIMIT 1`)
    .get(householdId, type);
  return Boolean(row);
}

function createAlert(householdId, type, flowRateLabel, thresholdLabel) {
  const id = nextAlertId();
  insertAlertStmt.run(id, householdId, type, flowRateLabel, thresholdLabel);
  const alert = db
    .prepare(`SELECT a.*, h.name, h.standpost FROM alerts a JOIN households h ON h.id = a.household_id WHERE a.id = ?`)
    .get(id);
  events.broadcast("alert", alert);
  return alert;
}

// Auto-resolves any open alert of `type` for a household — used when a live
// signal proves the underlying condition cleared on its own (e.g. a device
// that had gone silent is reporting readings again), so the dashboard
// doesn't keep showing a stale alert an admin never had to act on.
function autoResolve(householdId, type) {
  const row = db
    .prepare(`SELECT id FROM alerts WHERE household_id = ? AND type = ? AND status = 'Unresolved' LIMIT 1`)
    .get(householdId, type);
  if (!row) return;
  db.prepare(`UPDATE alerts SET status = 'Resolved' WHERE id = ?`).run(row.id);
  events.broadcast("alert_resolved", { id: row.id });
}

module.exports = {
  nextAlertId,
  hasRecentUnresolvedAlert,
  hasUnresolvedAlertOfType,
  createAlert,
  autoResolve,
};
