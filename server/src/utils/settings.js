// Admin-configurable thresholds for real-time leak / abnormal-usage
// detection, persisted in app_settings so they survive a restart and take
// effect immediately (detection code re-reads them on every check — no
// caching, no restart needed after an admin changes them from Settings).
const { db } = require("../db/database");

const ALERT_SETTINGS_DEFAULTS = {
  // High Flow adapts to each household's own usage (flowDetection.js
  // computeAdaptiveHighFlowLpm): highFlowLpm is the minimum threshold, and
  // the one used until a household has enough history to learn from.
  highFlowLpm: 15, // a single reading at/above this = a wide-open tap or burst
  highFlowLearnDays: 14, // learn from this many days of the household's readings
  highFlowLearnMultiplier: 1.5, // threshold = household's typical peak flow × this
  highFlowMinSamples: 20, // flowing readings needed before learning kicks in (~5 min of use at 15s reports)
  highFlowMaxLpm: 40, // learning never raises the threshold above this
  // Anything faster than this can't be real water through a household sensor
  // (a YF-S201 tops out around 30 L/min) — it's electrical noise, e.g. a
  // loose signal wire. Such readings are discarded instead of billed.
  maxPlausibleFlowLpm: 100,
  leakFlowLpm: 2, // low but non-zero — the signature of a persistent drip/leak
  leakSustainedMinutes: 15, // ...if it's been continuous for this long, it's a leak
  leakMaxGapMinutes: 5, // a gap bigger than this breaks a leak streak
  highUsageRatio: 1.6, // a billing cycle at/above this × the household's average -> High Flow
  leakUsageRatio: 2.2, // ...at/above this × average -> Leak Detected instead
  // No readings for this long from a provisioned device -> No Sensor Data.
  // The reference firmware (firmware/esp_water_meter) reports every ~15s by
  // default, so 5 minutes is ~20 missed reports before flagging it —
  // enough to shrug off a brief WiFi blip while still catching a dead device
  // promptly instead of leaving it dark for the better part of an hour.
  deviceSilenceMinutes: 5,
  alertThrottleMinutes: 30, // don't re-alert the same type back-to-back
};

const getStmt = db.prepare("SELECT value FROM app_settings WHERE key = ?");
const upsertStmt = db.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
);

const SETTINGS_KEY = "alertThresholds";

function getAlertSettings() {
  const row = getStmt.get(SETTINGS_KEY);
  if (!row) return { ...ALERT_SETTINGS_DEFAULTS };
  try {
    return { ...ALERT_SETTINGS_DEFAULTS, ...JSON.parse(row.value) };
  } catch {
    // Corrupt/unexpected stored value — fall back to defaults rather than
    // let bad data in app_settings break every detection check.
    return { ...ALERT_SETTINGS_DEFAULTS };
  }
}

// Merges `partial` (any subset of ALERT_SETTINGS_DEFAULTS' keys) onto the
// current settings and persists the result. Unknown keys are ignored; known
// keys must be positive finite numbers, or the whole update is rejected
// (nothing written) so a bad request can't leave settings half-updated.
function updateAlertSettings(partial) {
  const current = getAlertSettings();
  const next = { ...current };
  for (const key of Object.keys(ALERT_SETTINGS_DEFAULTS)) {
    if (partial[key] === undefined) continue;
    const value = Number(partial[key]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} must be a positive number.`);
    }
    next[key] = value;
  }
  upsertStmt.run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

module.exports = { getAlertSettings, updateAlertSettings, ALERT_SETTINGS_DEFAULTS };
