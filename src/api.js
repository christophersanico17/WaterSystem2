// Thin fetch wrapper for the Barangay Kinamlutan Water System backend.
// Every function here matches an import used in WaterSystemPrototype.jsx.

// Dev: Vite on :5173 talks to the API on :4000. Production build: the
// frontend is served by the API server itself (server/src/index.js), so the
// API is same-origin at /api — works unchanged on whatever domain it's hosted.
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:4000/api" : "/api");

// Admin and resident sessions are independent — each gets its own storage
// key so logging into one (e.g. in another tab) can't overwrite the other's
// token mid-session and cause its requests to start failing with 403s.
const TOKEN_KEYS = { admin: "bkws_admin_token", resident: "bkws_resident_token" };

export function getToken(role) {
  return localStorage.getItem(TOKEN_KEYS[role]);
}

function setToken(role, token) {
  if (token) localStorage.setItem(TOKEN_KEYS[role], token);
}

function clearToken(role) {
  localStorage.removeItem(TOKEN_KEYS[role]);
}

// Auto-detects which session (if any) is active in this browser tab, so the
// fetchers shared between the admin dashboard and the resident portal (same
// endpoint, different scope) attach whichever token is actually present
// instead of always going out unauthenticated. Admin wins if somehow both
// are set. Undefined (neither) means the request goes out with no auth
// header at all — the server then returns only whatever's safe to show an
// anonymous caller (e.g. the resident login dropdown's minimal fields).
function activeAuthRole() {
  if (getToken("admin")) return "admin";
  if (getToken("resident")) return "resident";
  return undefined;
}

async function request(path, { method = "GET", body, auth } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken(auth);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      "Could not reach the server. Is the backend running? (npm run dev in /server)"
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    // Only the auth *middleware's* own two messages mean the session itself
    // is the problem — every other 401 (e.g. "Current password is incorrect.")
    // is a legitimate, specific error from the route and must pass through
    // unchanged, or real mistakes get misreported as expired sessions.
    const authExpiredMessages = ["Missing authorization token.", "Invalid or expired token."];
    if (response.status === 401 && auth && authExpiredMessages.includes(data && data.error)) {
      throw new Error("Your session has expired. Please log out and log back in.");
    }
    throw new Error((data && data.error) || `Request failed (${response.status}).`);
  }

  return data;
}

// ── Admin auth ────────────────────────────────────────────────

export async function adminLogin(email, password, firstName, lastName) {
  const data = await request("/admin/login", {
    method: "POST",
    body: { email, password, firstName, lastName },
  });
  if (!data.success) {
    throw new Error(data.message || "Login failed.");
  }
  setToken("admin", data.token);
  return {
    email: data.email,
    role: data.role || "officer",
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    name: data.name || null,
  };
}

export function adminLogout() {
  clearToken("admin");
}

export async function adminForgotPassword(email) {
  return request("/admin/forgot-password", {
    method: "POST",
    body: { email },
  });
}

export async function adminResetPassword({ email, code, newPassword }) {
  return request("/admin/reset-password", {
    method: "POST",
    body: { email, code, newPassword },
  });
}

// ── Staff accounts (officer only) ───────────────────────────────
// One login per staff member instead of a shared account, so the audit log
// (which records actor_email on every action) can actually attribute who
// did what — see server/src/routes/adminAccounts.js.

export async function fetchAdminAccounts() {
  return request("/admin/accounts", { auth: "admin" });
}

export async function createAdminAccount({ email, password, role, firstName, lastName }) {
  return request("/admin/accounts", {
    method: "POST",
    body: { email, password, role, firstName, lastName },
    auth: "admin",
  });
}

export async function deleteAdminAccount(email) {
  return request(`/admin/accounts/${encodeURIComponent(email)}`, {
    method: "DELETE",
    auth: "admin",
  });
}

// Self-service edit of your OWN account — any field left undefined keeps
// its current value server-side. Changing email or password requires
// currentPassword. On success, swaps in the fresh token the server issues
// (the old one's claims may now be stale) so the session stays valid.
export async function updateAdminProfile({ firstName, lastName, email, currentPassword, newPassword }) {
  const data = await request("/admin/me", {
    method: "PATCH",
    body: { firstName, lastName, email, currentPassword, newPassword },
    auth: "admin",
  });
  if (data.token) setToken("admin", data.token);
  return data;
}

// ── Resident auth ─────────────────────────────────────────────
// These aren't in WaterSystemPrototype.jsx's import list yet, but are
// needed to wire resident login (including Google) through the API.
// Exported here so the prototype file can import them once USE_API
// resident-login support is added.

export async function residentLogin({ householdId, password, confirmPassword, email, firstName, lastName }) {
  const data = await request("/resident/login", {
    method: "POST",
    body: { householdId, password, confirmPassword, email, firstName, lastName },
  });
  if (data.success && data.token) {
    setToken("resident", data.token);
  }
  return data; // { success, message?, token?, householdId? }
}

export async function residentGoogleLogin({ householdId, credential }) {
  const data = await request("/resident/google-login", {
    method: "POST",
    body: { householdId, credential },
  });
  if (data.success && data.token) {
    setToken("resident", data.token);
  }
  return data; // { success, message?, token?, householdId?, googleProfile? }
}

export async function fetchGoogleLinkStatus(householdId) {
  return request(`/resident/google-status?householdId=${encodeURIComponent(householdId)}`);
}

export async function residentForgotPassword(householdId) {
  return request("/resident/forgot-password", {
    method: "POST",
    body: { householdId },
  });
}

export async function unlinkGoogleAccount(householdId) {
  return request("/resident/google-unlink", {
    method: "POST",
    body: { householdId },
    auth: "resident",
  });
}

export function residentLogout() {
  clearToken("resident");
}

// ── Residents / households ──────────────────────────────────

export async function fetchResidents() {
  return request("/residents", { auth: activeAuthRole() });
}

export async function createHousehold(payload) {
  return request("/residents", {
    method: "POST",
    body: payload,
    auth: "admin",
  });
}

export async function updateResidentProfile(householdId, updates) {
  return request(`/residents/${encodeURIComponent(householdId)}`, {
    method: "PATCH",
    body: updates,
    auth: "resident",
  });
}

export async function resetResidentPassword(householdId) {
  return request(`/residents/${encodeURIComponent(householdId)}/reset-password`, {
    method: "POST",
    auth: "admin",
  });
}

// Admin sets and confirms a new password for a resident directly — the
// no-verification-code replacement for the old email/SMS reset-code flow.
export async function confirmResidentPasswordReset(householdId, newPassword) {
  return request(`/residents/${encodeURIComponent(householdId)}/reset-password`, {
    method: "POST",
    body: { newPassword },
    auth: "admin",
  });
}

// ── Bills ────────────────────────────────────────────────────

export async function fetchBills() {
  return request("/bills", { auth: activeAuthRole() });
}

export async function fetchBillingPeriods() {
  return request("/bills/periods");
}

export async function generateBills(period) {
  return request("/bills/generate", {
    method: "POST",
    body: { period },
    auth: "admin",
  });
}

export async function recordCash(billId, amount, method = "Offline", reference) {
  return request(`/bills/${billId}/mark-paid`, {
    method: "POST",
    body: { method, amount, reference },
    auth: "admin",
  });
}

export async function recordUnpaid(billId) {
  return request(`/bills/${billId}/mark-unpaid`, {
    method: "POST",
    auth: "admin",
  });
}

export async function initiateGcash(billId) {
  return request(`/bills/${billId}/gcash/initiate`, {
    method: "POST",
    auth: "resident",
  });
}

export async function submitGcashReference(billId, reference) {
  return request(`/bills/${billId}/gcash/reference`, {
    method: "POST",
    body: { reference },
    auth: "resident",
  });
}

export async function confirmGcash(billId, reference) {
  return request(`/bills/${billId}/gcash/confirm`, {
    method: "POST",
    body: reference ? { reference } : undefined,
    auth: "admin",
  });
}

// Resident declares intent to pay in cash at the barangay office — marks
// the bill "Cash Pending". Unlike GCash there's no third party to verify
// the handoff, so this can never become "Paid" on its own; an admin must
// confirm it via confirmCash() once they've actually received the cash.
export async function initiateCash(billId) {
  return request(`/bills/${billId}/cash/initiate`, {
    method: "POST",
    auth: "resident",
  });
}

export async function confirmCash(billId) {
  return request(`/bills/${billId}/cash/confirm`, {
    method: "POST",
    auth: "admin",
  });
}

// Re-checks a pending GCash (PayMongo) payment and marks it Paid if PayMongo
// confirms it. Callable by the resident who owns the bill or by an admin —
// `auth` is picked per-caller since this module doesn't know which is signed in.
export async function syncGcash(billId, auth) {
  return request(`/bills/${billId}/gcash/sync`, {
    method: "POST",
    auth,
  });
}

// Same as syncGcash, but resolves the household's current bill server-side —
// used right after the PayMongo checkout redirect, before bill data has
// necessarily been (re)loaded on this page.
export async function syncGcashByHousehold(householdId, auth) {
  return request(`/households/${encodeURIComponent(householdId)}/gcash/sync`, {
    method: "POST",
    auth,
  });
}

export async function fetchPayments(householdId) {
  const qs = householdId ? `?householdId=${encodeURIComponent(householdId)}` : "";
  return request(`/payments${qs}`, { auth: activeAuthRole() });
}

// ── Readings ─────────────────────────────────────────────────

export async function fetchReadings(householdId) {
  return request(`/readings?householdId=${encodeURIComponent(householdId)}`, { auth: activeAuthRole() });
}

export async function fetchLatestReading(meterNo) {
  return request(`/readings/latest/${encodeURIComponent(meterNo)}`, { auth: activeAuthRole() });
}

// ── Alerts ───────────────────────────────────────────────────

export async function fetchAlerts() {
  return request("/alerts", { auth: activeAuthRole() });
}

export async function resolveAlertApi(alertId) {
  return request(`/alerts/${alertId}/resolve`, { method: "POST", auth: "admin" });
}

export async function unresolveAlertApi(alertId) {
  return request(`/alerts/${alertId}/unresolve`, { method: "POST", auth: "admin" });
}

// This household's own alerts — same detection as the admin Alerts page,
// scoped to the logged-in resident so they can see a real-time leak/high-flow
// hit without waiting for the next billing cycle's usage banner.
export async function fetchMyAlerts() {
  return request("/alerts/mine", { auth: "resident" });
}

// ── Detection settings ───────────────────────────────────────
// Real-time leak / abnormal-usage thresholds (routes/settings.js). Read on
// the admin Settings page and by the detectors themselves server-side.

export async function fetchAlertSettings() {
  return request("/settings/alerts", { auth: "admin" });
}

export async function updateAlertSettingsApi(settings) {
  return request("/settings/alerts", { method: "PUT", body: settings, auth: "admin" });
}

// ── Leak reports ─────────────────────────────────────────────

export async function submitLeakReport({ location, description, severity, contactBack }) {
  return request("/leak-reports", {
    method: "POST",
    body: { location, description, severity, contactBack },
    auth: "resident",
  });
}

export async function fetchLeakReports() {
  return request("/leak-reports", { auth: "admin" });
}

export async function resolveLeakReportApi(id) {
  return request(`/leak-reports/${id}/resolve`, { method: "POST", auth: "admin" });
}

export async function unresolveLeakReportApi(id) {
  return request(`/leak-reports/${id}/unresolve`, { method: "POST", auth: "admin" });
}

// ── Announcements ────────────────────────────────────────────
// GET is public (residents read it); create/update/delete require an
// admin token with the Water Officer role (enforced server-side).

export async function fetchAnnouncements() {
  return request("/announcements");
}

export async function createAnnouncement(payload) {
  return request("/announcements", { method: "POST", body: payload, auth: "admin" });
}

export async function updateAnnouncement(id, payload) {
  return request(`/announcements/${id}`, { method: "PUT", body: payload, auth: "admin" });
}

export async function deleteAnnouncement(id) {
  return request(`/announcements/${id}`, { method: "DELETE", auth: "admin" });
}

// ── Audit log ────────────────────────────────────────────────
// Water Officer only (enforced server-side).

export async function fetchAuditLog(limit = 200) {
  return request(`/audit?limit=${limit}`, { auth: "admin" });
}

// ── IoT devices (Arduino/ESP flow-sensor meters) ────────────────
// The device itself never talks to this file — it POSTs straight to
// /api/devices/readings with an X-Device-Key header (see firmware/). These
// are the admin-side provisioning/management calls only.

export async function fetchDeviceStatus(householdId) {
  return request(`/households/${encodeURIComponent(householdId)}/device`, { auth: "admin" });
}

// Returns { success, deviceKey } — deviceKey is shown once, same as most
// API-key UIs. Calling this again rotates the key and invalidates the old one.
export async function provisionDevice(householdId) {
  return request(`/households/${encodeURIComponent(householdId)}/device/provision`, {
    method: "POST",
    auth: "admin",
  });
}

export async function revokeDevice(householdId) {
  return request(`/households/${encodeURIComponent(householdId)}/device/revoke`, {
    method: "POST",
    auth: "admin",
  });
}

export async function setDeviceCalibration(householdId, pulsesPerLiter) {
  return request(`/households/${encodeURIComponent(householdId)}/device/calibration`, {
    method: "POST",
    body: { pulsesPerLiter },
    auth: "admin",
  });
}

// Builds the URL for the admin's live Server-Sent Events stream (new
// readings + alerts as devices report them). EventSource can't set an
// Authorization header, so the token travels as a query param instead —
// see server/src/routes/events.js for how it's verified there.
export function liveEventsUrl() {
  const token = getToken("admin");
  if (!token) return null;
  return `${API_BASE}/events/stream?token=${encodeURIComponent(token)}`;
}