// Freshness-based status for a household's flow-sensor device, shared by the
// admin and resident views so both show the same "is this meter reporting
// right now" answer from the same data.
//
// The firmware reports every ~15s (REPORT_INTERVAL_MS in
// firmware/esp_water_meter/config.h), so 45s = three missed reports: long
// enough to ride out one slow or dropped report, short enough that an
// unplugged device shows Offline within a minute.
export const DEVICE_ONLINE_MS = 45_000;

// Views re-render on this interval so Online ages into Offline on screen
// even when no new data arrives (a device going quiet produces no event).
export const DEVICE_STATUS_TICK_MS = 5_000;

export function deviceAgeMs(household) {
  if (!household.deviceLastSeen) return null;
  return Date.now() - new Date(household.deviceLastSeen.replace(" ", "T") + "Z").getTime();
}

export function isDeviceOnline(household) {
  const age = deviceAgeMs(household);
  return Boolean(household.deviceProvisioned) && age !== null && age < DEVICE_ONLINE_MS;
}

function formatAgo(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// { label, tone, online } for display.
export function deviceStatus(household) {
  if (!household.deviceProvisioned) return { label: "Not connected", tone: "text-slate-400", online: false };
  const age = deviceAgeMs(household);
  if (age === null) return { label: "Awaiting first reading", tone: "text-amber-600", online: false };
  if (age < DEVICE_ONLINE_MS) return { label: "● Online", tone: "text-emerald-600", online: true };
  return { label: `● Offline · last seen ${formatAgo(age)}`, tone: "text-red-600", online: false };
}
