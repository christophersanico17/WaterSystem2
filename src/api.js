// Thin fetch wrapper for the Barangay Kinamlutan Water System backend.
// Every function here matches an import used in WaterSystemPrototype.jsx.

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

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
    throw new Error((data && data.error) || `Request failed (${response.status}).`);
  }

  return data;
}

// ── Admin auth ────────────────────────────────────────────────

export async function adminLogin(email, password) {
  const data = await request("/admin/login", {
    method: "POST",
    body: { email, password },
  });
  if (!data.success) {
    throw new Error(data.message || "Login failed.");
  }
  setToken("admin", data.token);
  return { email: data.email, role: data.role || "officer" };
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

// ── Resident auth ─────────────────────────────────────────────
// These aren't in WaterSystemPrototype.jsx's import list yet, but are
// needed to wire resident login (including Google) through the API.
// Exported here so the prototype file can import them once USE_API
// resident-login support is added.

export async function residentLogin({ householdId, password, confirmPassword, email, username }) {
  const data = await request("/resident/login", {
    method: "POST",
    body: { householdId, password, confirmPassword, email, username },
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

export async function residentResetPassword({ householdId, code, newPassword, confirmPassword }) {
  return request("/resident/reset-password", {
    method: "POST",
    body: { householdId, code, newPassword, confirmPassword },
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
  return request("/residents");
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

// ── Bills ────────────────────────────────────────────────────

export async function fetchBills() {
  return request("/bills");
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

export async function recordCash(billId, amount) {
  return request(`/bills/${billId}/mark-paid`, {
    method: "POST",
    body: { method: "Offline", amount },
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

export async function confirmGcash(billId) {
  return request(`/bills/${billId}/gcash/confirm`, {
    method: "POST",
    auth: "admin",
  });
}

export async function fetchPayments(householdId) {
  const qs = householdId ? `?householdId=${encodeURIComponent(householdId)}` : "";
  return request(`/payments${qs}`);
}

// ── Readings ─────────────────────────────────────────────────

export async function fetchReadings(householdId) {
  return request(`/readings?householdId=${encodeURIComponent(householdId)}`);
}

export async function fetchLatestReading(meterNo) {
  return request(`/readings/latest/${encodeURIComponent(meterNo)}`);
}

// ── Alerts ───────────────────────────────────────────────────

export async function fetchAlerts() {
  return request("/alerts");
}

export async function resolveAlertApi(alertId) {
  return request(`/alerts/${alertId}/resolve`, { method: "POST", auth: "admin" });
}

export async function unresolveAlertApi(alertId) {
  return request(`/alerts/${alertId}/unresolve`, { method: "POST", auth: "admin" });
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