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

// Nearest-rank percentile of an unsorted array of numbers (p in 0..100).
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

// Works out a household's own High Flow threshold from its recent flow rates
// (only readings where water was actually running, i.e. flow_rate > 0).
//
// A fixed threshold for everyone keeps alerting on households whose normal
// usage is simply heavier (bigger family, a pump filling a tank...). So once
// there's enough history, the threshold becomes that household's typical
// peak flow (95th percentile — occasional spikes don't count as "typical")
// times highFlowLearnMultiplier. It is clamped to:
//   - never below highFlowLpm: that stays the minimum, and the threshold
//     used until the household has highFlowMinSamples readings of history;
//   - never above highFlowMaxLpm: a real burst is always flagged, even if
//     the history the threshold learned from was itself unusually high.
function computeAdaptiveHighFlowLpm(activeFlowRates, settings) {
  const floor = settings.highFlowLpm;
  const cap = Math.max(settings.highFlowMaxLpm, floor);
  const samples = activeFlowRates.length;

  if (samples < settings.highFlowMinSamples) {
    return { thresholdLpm: floor, learned: false, typicalPeakLpm: null, samples };
  }

  const typicalPeakLpm = percentile(activeFlowRates, 95);
  const learnedLpm = typicalPeakLpm * settings.highFlowLearnMultiplier;
  const thresholdLpm = +Math.min(cap, Math.max(floor, learnedLpm)).toFixed(1);
  return { thresholdLpm, learned: true, typicalPeakLpm: +typicalPeakLpm.toFixed(2), samples };
}

// Decides which real-time alert type(s), if any, a single flow-rate reading
// plus its leak streak should raise. A reading can be both a burst (High
// Flow) and part of a longer leak streak at the same time, so this returns
// an array rather than a single verdict. `highFlowLpm` is the household's
// own threshold (computeAdaptiveHighFlowLpm), defaulting to the global one.
function classifyRealTimeFlow(flowRateLpm, streakMinutes, settings, highFlowLpm = settings.highFlowLpm) {
  const types = [];
  if (flowRateLpm >= highFlowLpm) types.push("High Flow");
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
  computeAdaptiveHighFlowLpm,
  classifyRealTimeFlow,
  classifyConsumptionRatio,
};
