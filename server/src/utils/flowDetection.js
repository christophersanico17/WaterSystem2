// Pure decision logic for real-time flow and billing-cycle abnormal-usage
// detection — no DB, no Express, so it can be unit tested directly. Callers
// (routes/devices.js, routes/data.js) own fetching the data and writing the
// resulting alert; this module only decides what the data means.

// SQLite's own "YYYY-MM-DD HH:MM:SS" (UTC, no "Z") timestamp shape, parsed
// the same way it's written everywhere else in this app.
function toMs(sqliteTimestamp) {
  return new Date(String(sqliteTimestamp).replace(" ", "T") + "Z").getTime();
}

// Given a household's recent *device* readings (newest first) and the leak
// threshold, walks back through them while flow has stayed continuously
// at/above that threshold and returns how many minutes that streak spans (0
// if the most recent reading isn't itself at/above threshold).
//
// A gap bigger than `leakMaxGapMinutes` between two readings breaks the
// streak — otherwise a device that reported high flow once weeks ago and
// again just now would look "continuous" purely because nothing in between
// said otherwise.
function computeLeakStreakMinutes(recentReadingsDesc, settings, nowMs) {
  const { leakFlowLpm, leakMaxGapMinutes } = settings;
  if (!recentReadingsDesc.length) return 0;

  let streakStart = null;
  let prevMs = null;
  for (const r of recentReadingsDesc) {
    const rMs = toMs(r.recorded_at);
    const gapMinutes = prevMs !== null ? (prevMs - rMs) / 60000 : 0;
    if (r.flow_rate >= leakFlowLpm && gapMinutes <= leakMaxGapMinutes) {
      streakStart = r.recorded_at;
      prevMs = rMs;
    } else {
      break;
    }
  }

  if (!streakStart) return 0;
  return (nowMs - toMs(streakStart)) / 60000;
}

// Decides which real-time alert type(s), if any, a single flow-rate reading
// plus its leak streak should raise. A reading can be both a burst (High
// Flow) and part of a longer leak streak at the same time, so this returns
// an array rather than a single verdict.
function classifyRealTimeFlow(flowRateLpm, streakMinutes, settings) {
  const types = [];
  if (flowRateLpm >= settings.highFlowLpm) types.push("High Flow");
  if (flowRateLpm >= settings.leakFlowLpm && streakMinutes >= settings.leakSustainedMinutes) {
    types.push("Leak Detected");
  }
  return types;
}

// Decides the alert type (or null) for a billing cycle's consumption against
// the household's own historical average.
function classifyConsumptionRatio(consumption, avgConsumption, settings) {
  if (!Number.isFinite(avgConsumption) || avgConsumption <= 0) return null;
  const ratio = consumption / avgConsumption;
  if (ratio < settings.highUsageRatio) return null;
  return ratio >= settings.leakUsageRatio ? "Leak Detected" : "High Flow";
}

module.exports = {
  toMs,
  computeLeakStreakMinutes,
  classifyRealTimeFlow,
  classifyConsumptionRatio,
};
