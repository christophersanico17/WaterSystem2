const express = require("express");
const { authMiddleware } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");
const { getAlertSettings, updateAlertSettings } = require("../utils/settings");

const router = express.Router();

// GET /api/settings/alerts  (admin) — current leak/abnormal-usage detection
// thresholds, for the Settings page to display. Any admin staff role can
// view; only officers (see PUT below) can change them.
router.get("/settings/alerts", authMiddleware("admin"), (req, res) => {
  res.json(getAlertSettings());
});

// PUT /api/settings/alerts  (admin, officer only) — update one or more
// thresholds. Body may include any subset of the keys in
// utils/settings.js#ALERT_SETTINGS_DEFAULTS; omitted keys keep their current
// value. Takes effect immediately — the detectors read these fresh on every
// check, no restart required.
router.put("/settings/alerts", authMiddleware("admin", ["officer"]), (req, res) => {
  try {
    const next = updateAlertSettings(req.body || {});
    recordAudit(req, "settings.alerts_update", "alertThresholds", `Updated alert thresholds: ${JSON.stringify(next)}`);
    res.json({ success: true, settings: next });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
