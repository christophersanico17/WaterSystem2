const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeLeakStreakMinutes,
  classifyRealTimeFlow,
  classifyConsumptionRatio,
} = require("../src/utils/flowDetection");

const settings = {
  highFlowLpm: 15,
  leakFlowLpm: 2,
  leakSustainedMinutes: 15,
  leakMaxGapMinutes: 5,
  highUsageRatio: 1.6,
  leakUsageRatio: 2.2,
};

// Readings are stored/read as SQLite's "YYYY-MM-DD HH:MM:SS" (UTC, no "Z").
function sqlTime(msAgo, fromMs) {
  return new Date(fromMs - msAgo).toISOString().slice(0, 19).replace("T", " ");
}

test("computeLeakStreakMinutes: empty history is not a streak", () => {
  assert.equal(computeLeakStreakMinutes([], settings, Date.now()), 0);
});

test("computeLeakStreakMinutes: a single below-threshold reading is not a streak", () => {
  const now = Date.now();
  const readings = [{ flow_rate: 1, recorded_at: sqlTime(0, now) }];
  assert.equal(computeLeakStreakMinutes(readings, settings, now), 0);
});

test("computeLeakStreakMinutes: sums a continuous run of at/above-threshold readings", () => {
  const now = Date.now();
  // Readings every minute, newest first, all at 3 L/min for the last 20 minutes.
  const readings = Array.from({ length: 20 }, (_, i) => ({
    flow_rate: 3,
    recorded_at: sqlTime(i * 60 * 1000, now),
  }));
  const minutes = computeLeakStreakMinutes(readings, settings, now);
  assert.ok(minutes >= 19 && minutes <= 20, `expected ~19-20 minutes, got ${minutes}`);
});

test("computeLeakStreakMinutes: a gap bigger than leakMaxGapMinutes breaks the streak", () => {
  const now = Date.now();
  const readings = [
    { flow_rate: 3, recorded_at: sqlTime(0, now) },
    { flow_rate: 3, recorded_at: sqlTime(1 * 60 * 1000, now) },
    // 30-minute gap here — well past leakMaxGapMinutes (5)
    { flow_rate: 3, recorded_at: sqlTime(31 * 60 * 1000, now) },
    { flow_rate: 3, recorded_at: sqlTime(32 * 60 * 1000, now) },
  ];
  const minutes = computeLeakStreakMinutes(readings, settings, now);
  assert.ok(minutes >= 0.9 && minutes <= 1.1, `expected ~1 minute (stops at the gap), got ${minutes}`);
});

test("computeLeakStreakMinutes: a below-threshold reading one step back stops the streak at the latest reading", () => {
  const now = Date.now();
  const readings = [
    { flow_rate: 3, recorded_at: sqlTime(0, now) }, // at/above threshold right now...
    { flow_rate: 0, recorded_at: sqlTime(1 * 60 * 1000, now) }, // ...but off a minute ago, so the streak is just this one reading
    { flow_rate: 3, recorded_at: sqlTime(2 * 60 * 1000, now) },
  ];
  const minutes = computeLeakStreakMinutes(readings, settings, now);
  assert.ok(minutes >= 0 && minutes < 0.1, `expected ~0 minutes (streak is only the latest reading), got ${minutes}`);
});

test("classifyRealTimeFlow: below every threshold raises nothing", () => {
  assert.deepEqual(classifyRealTimeFlow(1, 0, settings), []);
});

test("classifyRealTimeFlow: a burst at/above highFlowLpm raises High Flow immediately, even with no streak", () => {
  assert.deepEqual(classifyRealTimeFlow(20, 0, settings), ["High Flow"]);
});

test("classifyRealTimeFlow: sustained low flow raises Leak Detected but not High Flow", () => {
  assert.deepEqual(classifyRealTimeFlow(3, 20, settings), ["Leak Detected"]);
});

test("classifyRealTimeFlow: low flow not yet sustained long enough raises nothing", () => {
  assert.deepEqual(classifyRealTimeFlow(3, 5, settings), []);
});

test("classifyRealTimeFlow: a sustained high-flow burst raises both", () => {
  assert.deepEqual(classifyRealTimeFlow(20, 20, settings), ["High Flow", "Leak Detected"]);
});

test("classifyConsumptionRatio: no history to compare against -> null", () => {
  assert.equal(classifyConsumptionRatio(50, 0, settings), null);
  assert.equal(classifyConsumptionRatio(50, NaN, settings), null);
});

test("classifyConsumptionRatio: below highUsageRatio -> null", () => {
  assert.equal(classifyConsumptionRatio(15, 10, settings), null); // 1.5x
});

test("classifyConsumptionRatio: at/above highUsageRatio but below leakUsageRatio -> High Flow", () => {
  assert.equal(classifyConsumptionRatio(16, 10, settings), "High Flow"); // 1.6x
  assert.equal(classifyConsumptionRatio(21, 10, settings), "High Flow"); // 2.1x
});

test("classifyConsumptionRatio: at/above leakUsageRatio -> Leak Detected", () => {
  assert.equal(classifyConsumptionRatio(22, 10, settings), "Leak Detected"); // 2.2x
  assert.equal(classifyConsumptionRatio(50, 10, settings), "Leak Detected"); // 5x
});
