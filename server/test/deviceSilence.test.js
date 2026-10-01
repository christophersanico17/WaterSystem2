// Uses an in-memory DB so this never touches the real water_system.db file.
// JWT_SECRET is only needed because routes/devices.js requires utils/auth,
// which throws at load time if it's unset — the value itself is unused here.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const devices = require("../src/routes/devices");
const alerts = require("../src/utils/alerts");
const { updateAlertSettings } = require("../src/utils/settings");

function sqlTime(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60000).toISOString().slice(0, 19).replace("T", " ");
}

function insertProvisionedHousehold(id, minutesSinceLastSeen) {
  db.prepare(
    `INSERT INTO households (id, name, standpost, meter, device_key, device_last_seen) VALUES (?, ?, 1, ?, ?, ?)`
  ).run(id, `Test household ${id}`, `M-${id}`, `dev_test_${id}`, sqlTime(minutesSinceLastSeen));
}

test("checkDeviceSilence raises No Sensor Data for a household past the configured threshold", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-1", 45); // silent for 45 min, threshold is 30

  devices.checkDeviceSilence();

  assert.ok(alerts.hasUnresolvedAlertOfType("HH-SIL-1", "No Sensor Data"));
});

test("checkDeviceSilence leaves a household alone while still within the threshold", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-2", 5); // only silent for 5 min

  devices.checkDeviceSilence();

  assert.ok(!alerts.hasUnresolvedAlertOfType("HH-SIL-2", "No Sensor Data"));
});

test("checkDeviceSilence does not raise a second alert while one is already open", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-3", 45);

  devices.checkDeviceSilence();
  devices.checkDeviceSilence(); // simulate a second sweep a few minutes later

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM alerts WHERE household_id = ? AND type = 'No Sensor Data'")
    .get("HH-SIL-3").n;
  assert.equal(count, 1);
});

test("a fresh reading auto-resolves an open No Sensor Data alert for that household", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-4", 45);
  devices.checkDeviceSilence();
  assert.ok(alerts.hasUnresolvedAlertOfType("HH-SIL-4", "No Sensor Data"));

  alerts.autoResolve("HH-SIL-4", "No Sensor Data"); // what the readings handler calls on every ingest

  assert.ok(!alerts.hasUnresolvedAlertOfType("HH-SIL-4", "No Sensor Data"));
});
