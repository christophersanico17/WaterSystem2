// Uses an in-memory DB (see src/db/database.js's DB_PATH override) so this
// never touches the real water_system.db file.
process.env.DB_PATH = ":memory:";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getAlertSettings, updateAlertSettings, ALERT_SETTINGS_DEFAULTS } = require("../src/utils/settings");

test("getAlertSettings returns the defaults when nothing has been saved yet", () => {
  assert.deepEqual(getAlertSettings(), ALERT_SETTINGS_DEFAULTS);
});

test("updateAlertSettings persists a partial update and merges it onto current values", () => {
  const next = updateAlertSettings({ highFlowLpm: 20 });
  assert.equal(next.highFlowLpm, 20);
  assert.equal(next.leakFlowLpm, ALERT_SETTINGS_DEFAULTS.leakFlowLpm); // untouched

  // ...and it's actually persisted, not just returned.
  assert.equal(getAlertSettings().highFlowLpm, 20);

  const second = updateAlertSettings({ leakSustainedMinutes: 10 });
  assert.equal(second.highFlowLpm, 20); // still there from the previous update
  assert.equal(second.leakSustainedMinutes, 10);
});

test("updateAlertSettings rejects a non-positive value and writes nothing", () => {
  const before = getAlertSettings();
  assert.throws(() => updateAlertSettings({ highFlowLpm: 0 }), /positive number/);
  assert.throws(() => updateAlertSettings({ leakUsageRatio: -1 }), /positive number/);
  assert.throws(() => updateAlertSettings({ deviceSilenceMinutes: "not a number" }), /positive number/);
  assert.deepEqual(getAlertSettings(), before);
});

test("updateAlertSettings ignores unknown keys", () => {
  const next = updateAlertSettings({ notARealSetting: 123, highFlowLpm: 25 });
  assert.equal(next.highFlowLpm, 25);
  assert.equal(next.notARealSetting, undefined);
});
