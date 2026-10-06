import React, { useState, useEffect, useRef, useCallback } from "react";
import { buildInitialAlerts, genReading, computeBill, peso } from "./data";
import { AdminView } from "./views/AdminView";
import { ResidentView } from "./views/ResidentView";
import { GcashModal } from "./components/GcashModal";
import { Toast, Btn } from "./ui/atoms";
import {
  getToken, adminLogin, adminLogout,
  fetchResidents, fetchBills, fetchBillingPeriods, generateBills,
  fetchReadings, fetchLatestReading,
  submitGcashReference, recordCash, recordUnpaid, confirmGcash, confirmCash, syncGcashByHousehold, fetchPayments,
  residentLogin, residentGoogleLogin, residentLogout,
  updateResidentProfile, resetResidentPassword, confirmResidentPasswordReset, resolveAlertApi, unresolveAlertApi,
  createHousehold, fetchAlerts, fetchMyAlerts,
  fetchLeakReports, resolveLeakReportApi, unresolveLeakReportApi,
  fetchDeviceStatus, provisionDevice, revokeDevice, setDeviceCalibration, liveEventsUrl,
  updateAdminProfile,
} from "./api";
import { residentToHousehold } from "./databridge.js";
import { jwtDecode } from "jwt-decode";

// ── Mode flag ─────────────────────────────────────────────────
// Set to true once you have the backend running and seeded.
// When false, the app runs fully on mock data (original behaviour).
const USE_API = true;

// Restore a saved session on refresh: decode the stored JWT and, if it's still
// valid (not expired), return its payload so the app can re-enter the portal
// instead of bouncing back to the login screen. Only used when USE_API is true.
function readSession(role) {
  if (!USE_API) return null;
  const token = getToken(role);
  if (!token) return null;
  try {
    const payload = jwtDecode(token);
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null; // expired
    return payload; // admin: { role, email }  |  resident: { role, householdId }
  } catch {
    return null;
  }
}

// The header's Admin/Resident toggle was removed — which portal shows is now
// determined by the URL path instead (/admin or /resident).
function getViewFromPath() {
  return window.location.pathname.startsWith("/resident") ? "resident" : "admin";
}

export default function WaterSystemPrototype() {
  // Rehydrate any saved session so a refresh keeps the admin/resident logged in.
  const adminSession = readSession("admin");
  const residentSession = readSession("resident");

  const [view] = useState(getViewFromPath);
  const [adminAuthenticated, setAdminAuthenticated] = useState(!!adminSession);
  const [residentAuthenticated, setResidentAuthenticated] = useState(!!residentSession);
  const [adminEmail, setAdminEmail] = useState(adminSession?.email || "");
  const [adminRole, setAdminRole] = useState(adminSession?.staffRole || "officer");
  const [adminName, setAdminName] = useState(adminSession?.name || "");
  const [residentLoginHouseholdId, setResidentLoginHouseholdId] = useState(null);

  // shared state — populated either from API or from mock data
  const [households, setHouseholds] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [leakReports, setLeakReports] = useState([]);
  const [myAlerts, setMyAlerts] = useState([]);
  const [activeResidentId, setActiveResidentId] = useState(residentSession?.householdId || null);

  const [toast, setToast] = useState(null);
  const [adminPage, setAdminPageState] = useState(() => {
    if (!adminSession) return "login";
    return localStorage.getItem("adminPage") || "dashboard";
  });
  const [residentPage, setResidentPageState] = useState(() => {
    if (!residentSession) return "login";
    return localStorage.getItem("residentPage") || "dashboard";
  });

  const setAdminPage = (page) => {
    setAdminPageState(page);
    localStorage.setItem("adminPage", page);
  };

  const setResidentPage = (page) => {
    setResidentPageState(page);
    localStorage.setItem("residentPage", page);
  };
  const [alertFilter, setAlertFilter] = useState("All");
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  // { id, action: "resolve" | "unresolve" } while a confirmation is pending.
  const [confirmAlert, setConfirmAlert] = useState(null);
  const [paymentStep, setPaymentStep] = useState("confirm");
  const [loading, setLoading] = useState(USE_API);

  const toastTimer = useRef(null);

  function showToast(message, tone = "info") {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  // ── Load data ───────────────────────────────────────────────
  // `silent` skips the full-screen loading state — used when refreshing after
  // an admin/resident action so the current page (filters, expanded rows,
  // scroll position) doesn't get torn down and remounted.
  const loadFromAPI = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      // allSettled, not all: /bills and /alerts now require a signed-in
      // admin or resident (they used to leak every household's data to
      // anyone — see server/src/routes/data.js). This loader also runs
      // pre-login (to populate the resident login screen's household
      // picker, which only needs /residents' anonymous minimal-fields
      // response), so those two are expected to 401/403 at that point —
      // that's correct, not a failure to recover from, hence the fallback
      // to [] below rather than bailing out to mock data.
      const [residentsResult, billsResult, periodsResult, alertsResult] = await Promise.allSettled([
        fetchResidents(),
        fetchBills(),
        fetchBillingPeriods(),
        fetchAlerts(),
      ]);
      const residents = residentsResult.status === "fulfilled" ? residentsResult.value : [];
      const bills = billsResult.status === "fulfilled" ? billsResult.value : [];
      const periods = periodsResult.status === "fulfilled" ? periodsResult.value : [];
      const rawAlerts = alertsResult.status === "fulfilled" ? alertsResult.value : [];

      if (residentsResult.status === "rejected") {
        throw residentsResult.reason; // the one fetch that must always succeed
      }

      // Group bills by household. Bill rows from GET /api/bills carry
      // `household_id` (not `resident_id` — that field only exists on rows
      // from GET /api/residents).
      const billsByResident = {};
      for (const b of bills) {
        if (!billsByResident[b.household_id]) billsByResident[b.household_id] = [];
        billsByResident[b.household_id].push(b);
      }

      // Fetch latest sensor reading per resident
      const readingResults = await Promise.allSettled(
        residents.map((r) => fetchLatestReading(r.meter_no))
      );

      const mapped = residents.map((r, idx) => {
        const residentBills = billsByResident[r.resident_id] || [];
        const latestBill = residentBills[residentBills.length - 1] || null;
        const reading = readingResults[idx].status === "fulfilled"
          ? readingResults[idx].value
          : null;
        return residentToHousehold(r, latestBill, reading, residentBills);
      });

      setHouseholds(mapped);
      setAlerts(
        rawAlerts.map((a) => ({
          id: a.id,
          householdId: a.household_id,
          name: a.name,
          standpost: a.standpost,
          type: a.type,
          flowRate: a.flow_rate,
          threshold: a.threshold,
          time: new Date(a.created_at.replace(" ", "T") + "Z").toLocaleString("en-PH", {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          }),
          status: a.status,
        }))
      );
      // Functional updates avoid reading activeResidentId/residentLoginHouseholdId
      // from this useCallback's stale closure (it's memoized with `[]` deps).
      if (mapped.length > 0) {
        setActiveResidentId((prev) => prev || mapped[0].id);
        setResidentLoginHouseholdId((prev) => prev || mapped[0].id);
      }
    } catch (err) {
      showToast("Could not connect to backend: " + err.message, "warn");
      // Fall back to mock data
      loadMockData();
    } finally {
      if (!silent) setLoading(false);
    }
  }, []); // eslint-disable-line

  function loadMockData() {
    // Original mock bootstrap (imported lazily to keep bundle clean)
    import("./data.js").then(({ buildInitialHouseholds, buildInitialAlerts }) => {
      const h = buildInitialHouseholds();
      setHouseholds(h);
      setAlerts(buildInitialAlerts(h));
      setActiveResidentId((prev) => prev || h[0].id);
      setResidentLoginHouseholdId((prev) => prev || h[0].id);
    });
  }

  useEffect(() => {
    if (USE_API) {
      loadFromAPI();
    } else {
      loadMockData();
    }
  }, []); // eslint-disable-line

  // Leak reports are admin-only server-side, so they can't ride along in
  // loadFromAPI's Promise.all (that runs before any login and would 401).
  // Fetch them once an admin session exists instead.
  const loadLeakReports = useCallback(async () => {
    if (!USE_API) return;
    try {
      const rows = await fetchLeakReports();
      setLeakReports(
        rows.map((r) => ({
          id: r.id,
          householdId: r.household_id,
          name: r.name,
          standpost: r.standpost,
          location: r.location,
          description: r.description,
          severity: r.severity,
          contactBack: !!r.contact_back,
          status: r.status,
          time: new Date(r.created_at.replace(" ", "T") + "Z").toLocaleString("en-PH", {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          }),
        }))
      );
    } catch {
      // Not logged in as admin yet, or the request failed — leave the page empty.
    }
  }, []);

  useEffect(() => {
    if (adminAuthenticated) loadLeakReports();
  }, [adminAuthenticated, loadLeakReports]);

  // Normalize the address bar to the canonical /admin or /resident path
  // (e.g. a visit to "/" becomes "/admin") now that there's no in-app toggle.
  useEffect(() => {
    const canonicalPath = view === "resident" ? "/resident" : "/admin";
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(null, "", canonicalPath);
    }
  }, [view]);

  // ── IoT simulation (mock mode only) ─────────────────────────
  useEffect(() => {
    if (USE_API) return; // backend pushes real data; no simulation needed
    if (households.length === 0) return;

    const interval = setInterval(() => {
      setHouseholds((prev) => {
        const idx = Math.floor(Math.random() * prev.length);
        const target = prev[idx];
        const { current, isAnomaly } = genReading(target.currCm3, 0.1);
        const consumption = current - target.prevCm3;
        const amount = computeBill(consumption);

        if (isAnomaly) {
          const newAlert = {
            id: `ALT-${Math.floor(Math.random() * 900 + 100)}`,
            householdId: target.id,
            name: target.name,
            standpost: target.standpost,
            type: Math.random() > 0.5 ? "Leak Detected" : "High Flow",
            flowRate: `${(60 + Math.random() * 40).toFixed(0)} L/m`,
            threshold: "50 L/m",
            time: "Just now",
            status: "Unresolved",
          };
          setAlerts((a) => [newAlert, ...a].slice(0, 10));
          showToast(`Abnormal usage detected — ${target.id} (${target.name})`, "warn");
        }

        const updated = [...prev];
        updated[idx] = {
          ...target,
          currCm3: current,
          consumption,
          amount,
          totalDue: +(amount + target.prevBalance).toFixed(2),
          lastFlow: isAnomaly ? 15 + Math.floor(Math.random() * 10) : 2 + Math.floor(Math.random() * 5),
          flowType: isAnomaly ? "High flow" : "Normal",
        };
        return updated;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [households.length]);

  // ── Admin login (Google) ─────────────────────────────────────
  async function handleAdminLogin({ email, password, firstName, lastName }) {
    if (!email || !password || !firstName || !lastName) {
      return { success: false, message: "First name, last name, email, and password are all required." };
    }

    if (USE_API) {
      try {
        const user = await adminLogin(email, password, firstName, lastName);
        setAdminEmail(user.email || email);
        setAdminRole(user.role || "officer");
        setAdminName(user.name || "");
        setAdminAuthenticated(true);
        setAdminPage("dashboard");
        return { success: true };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }

    if (email.toLowerCase() !== "admin@barangay.local" && email.toLowerCase() !== "wateroffice@barangay.local") {
      return { success: false, message: "Use an admin email such as admin@barangay.local." };
    }
    if (password.length < 8) {
      return { success: false, message: "Password must be at least 8 characters." };
    }

    setAdminEmail(email);
    setAdminName(`${firstName} ${lastName}`.trim());
    setAdminAuthenticated(true);
    setAdminPage("dashboard");
    return { success: true };
  }

  // Self-service profile edit (any signed-in admin, own account only).
  async function handleUpdateAdminProfile(updates) {
    if (!USE_API) {
      return { success: false, message: "Profile editing isn't available in demo mode." };
    }
    try {
      const result = await updateAdminProfile(updates);
      setAdminEmail(result.email || adminEmail);
      setAdminName(result.name || adminName);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  function handleAdminLogout() {
    if (USE_API) adminLogout();
    setAdminEmail("");
    setAdminName("");
    setAdminAuthenticated(false);
    setAdminPage("login");
  }

  // ── Resident login (standpost/password) ───────────────────────
  function isStrongPassword(value) {
    return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
  }

  async function handleResidentLogin({ householdId, password, confirmPassword, email, firstName, lastName }) {
    if (USE_API) {
      try {
        const result = await residentLogin({ householdId, password, confirmPassword, email, firstName, lastName });
        if (result.success) {
          setActiveResidentId(householdId);
          setResidentAuthenticated(true);
          setResidentPage("dashboard");
          await loadFromAPI(true); // refresh so the newly-set password flag etc. show up
        }
        return result;
      } catch (err) {
        return { success: false, message: err.message };
      }
    }

    const household = households.find((h) => h.id === householdId);
    if (!household) {
      return { success: false, message: "Select your standpost before logging in." };
    }

    const isNewPassword = !household.password;
    if (isNewPassword) {
      if (!isStrongPassword(password)) {
        return {
          success: false,
          message: "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.",
        };
      }
      if (password !== confirmPassword) {
        return { success: false, message: "Passwords do not match." };
      }
      setHouseholds((prev) => prev.map((h) => (h.id === householdId ? { ...h, password } : h)));
    }

    if (!isNewPassword && household.password !== password) {
      return { success: false, message: "Invalid password for this standpost." };
    }

    setActiveResidentId(householdId);
    setResidentAuthenticated(true);
    setResidentPage("dashboard");
    return { success: true };
  }

  // ── Resident login via Google ──────────────────────────────────
  // credential = the verified ID token string from Google's Sign-In button.
  // Only available when USE_API is true, since verifying a Google token
  // requires the backend (mock mode has no way to validate it).
  async function handleResidentGoogleLogin({ householdId, credential }) {
    if (!USE_API) {
      return {
        success: false,
        message: "Google Sign-In requires the backend to be running. Connect to the API first.",
      };
    }
    try {
      const result = await residentGoogleLogin({ householdId, credential });
      if (result.success) {
        setActiveResidentId(householdId);
        setResidentAuthenticated(true);
        setResidentPage("dashboard");
        await loadFromAPI(true);
      }
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  function handleResidentLogout() {
    if (USE_API) residentLogout();
    setResidentAuthenticated(false);
    setResidentPage("login");
  }

  // ── Resident profile edits ──────────────────────────────────
  async function handleUpdateProfile(householdId, updates) {
    // Password fields are write-only — send them to the API but never let
    // them land in app state (React devtools, re-renders, etc).
    const { currentPassword, newPassword, ...displayUpdates } = updates;
    if (USE_API) {
      try {
        await updateResidentProfile(householdId, updates);
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    setHouseholds((prev) =>
      prev.map((h) => (h.id === householdId ? { ...h, ...displayUpdates } : h))
    );
    return { success: true };
  }

  async function handleResetResidentPassword(householdId) {
    if (USE_API) {
      try {
        await resetResidentPassword(householdId);
        await loadFromAPI(true);
        showToast(`${householdId} password reset — resident must set a new one on next login.`, "info");
      } catch (err) {
        showToast("Could not reset password: " + err.message, "warn");
      }
      return;
    }
    setHouseholds((prev) => prev.map((h) => (h.id === householdId ? { ...h, password: null } : h)));
    showToast(`${householdId} password reset — resident must set a new one on next login.`, "info");
  }

  // Admin types the resident's new password directly and confirms it —
  // resolves any pending "forgot password" request without a code.
  async function handleConfirmPasswordReset(householdId, newPassword) {
    if (!USE_API) {
      setHouseholds((prev) =>
        prev.map((h) => (h.id === householdId ? { ...h, password: newPassword, passwordResetRequested: false } : h))
      );
      showToast(`${householdId} password set and confirmed.`, "success");
      return { success: true };
    }
    try {
      await confirmResidentPasswordReset(householdId, newPassword);
      await loadFromAPI(true);
      showToast(`${householdId} password set and confirmed.`, "success");
      return { success: true };
    } catch (err) {
      showToast("Could not set the new password: " + err.message, "warn");
      return { success: false, message: err.message };
    }
  }

  async function handleAddHousehold(payload) {
    if (!USE_API) {
      return { success: false, message: "Adding households requires the backend to be running." };
    }
    try {
      const result = await createHousehold(payload);
      await loadFromAPI(true);
      showToast(`Household ${result.id} connected.`, "success");
      return { success: true, id: result.id };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ── IoT device (Arduino/ESP flow-sensor meter) management ─────
  // Provisioning/calibration only — actual readings arrive out-of-band from
  // the device itself via POST /api/devices/readings, picked up in near
  // real time by the SSE subscription below rather than through these.
  async function handleProvisionDevice(householdId) {
    if (!USE_API) {
      showToast("Device provisioning requires the backend to be running.", "warn");
      return null;
    }
    try {
      const result = await provisionDevice(householdId);
      await loadFromAPI(true);
      showToast(`Device key generated for ${householdId}. Copy it now — it won't be shown again.`, "success");
      return result.deviceKey;
    } catch (err) {
      showToast("Could not provision device: " + err.message, "warn");
      return null;
    }
  }

  async function handleRevokeDevice(householdId) {
    if (!USE_API) return;
    try {
      await revokeDevice(householdId);
      await loadFromAPI(true);
      showToast(`Device key revoked for ${householdId}. That device can no longer submit readings.`, "info");
    } catch (err) {
      showToast("Could not revoke device: " + err.message, "warn");
    }
  }

  async function handleSetDeviceCalibration(householdId, pulsesPerLiter) {
    if (!USE_API) return;
    try {
      await setDeviceCalibration(householdId, pulsesPerLiter);
      await loadFromAPI(true);
      showToast(`Calibration updated for ${householdId} (${pulsesPerLiter} pulses/L).`, "success");
    } catch (err) {
      showToast("Could not update calibration: " + err.message, "warn");
    }
  }

  // ── Live sensor stream (Server-Sent Events) ────────────────────
  // While the admin is logged in, keep an open connection to the backend so
  // new device readings and alerts appear on the dashboard the moment
  // they're reported — no polling, no manual refresh. Falls back to nothing
  // special if it disconnects; the browser's EventSource retries on its own.
  useEffect(() => {
    if (!USE_API || !adminAuthenticated) return;
    const url = liveEventsUrl();
    if (!url) return;

    const source = new EventSource(url);

    source.addEventListener("reading", (e) => {
      const r = JSON.parse(e.data);
      setHouseholds((prev) =>
        prev.map((h) =>
          h.id === r.householdId
            ? {
                ...h,
                currCm3: r.cm3,
                lastFlow: r.flowRate,
                flowType: r.flowType,
                lastReadingAt: r.recordedAt,
                deviceLastSeen: r.recordedAt,
                // Rolling last 60 one-second slots (liters each), for the
                // per-second usage chart. Only lives in the browser —
                // starts empty when the page loads.
                perSecondLiters: [...(h.perSecondLiters || []), ...(r.perSecondLiters || [])].slice(-60),
              }
            : h
        )
      );
    });

    source.addEventListener("alert", (e) => {
      const a = JSON.parse(e.data);
      setAlerts((prev) => [
        {
          id: a.id,
          householdId: a.household_id,
          name: a.name,
          standpost: a.standpost,
          type: a.type,
          flowRate: a.flow_rate,
          threshold: a.threshold,
          time: new Date(a.created_at.replace(" ", "T") + "Z").toLocaleString("en-PH", {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          }),
          status: a.status,
        },
        ...prev,
      ].slice(0, 50));
      showToast(`${a.type} — ${a.household_id} (${a.name})`, "warn");
    });

    // The backend auto-resolves some alerts on its own (e.g. "No Sensor
    // Data" clears the moment a device reports again) — without this, the
    // dashboard would keep showing that alert as open until the next manual
    // refresh, even though it's already resolved server-side.
    source.addEventListener("alert_resolved", (e) => {
      const { id } = JSON.parse(e.data);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: "Resolved" } : a)));
    });

    // EventSource surfaces connection drops as a generic error with no
    // detail; it retries automatically, so this is just for visibility —
    // nothing to act on unless it keeps failing.
    source.onerror = () => {
      console.warn("Live sensor stream disconnected — retrying…");
    };

    return () => source.close();
  }, [adminAuthenticated]); // eslint-disable-line

  // ── Resident-facing alerts ──────────────────────────────────
  // Same real-time leak/high-flow/no-sensor-data detection the admin
  // dashboard shows, scoped to the logged-in resident's own household — so
  // they see a live device-detected issue instead of only the per-cycle
  // "High usage" banner (which only updates once a bill is generated).
  useEffect(() => {
    if (!USE_API || !residentAuthenticated) {
      setMyAlerts([]);
      return;
    }
    let cancelled = false;
    fetchMyAlerts()
      .then((rows) => {
        if (cancelled) return;
        setMyAlerts(
          rows.map((a) => ({
            id: a.id,
            type: a.type,
            flowRate: a.flow_rate,
            threshold: a.threshold,
            time: new Date(a.created_at.replace(" ", "T") + "Z").toLocaleString("en-PH", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            }),
            status: a.status,
          }))
        );
      })
      .catch(() => {}); // non-critical — the dashboard still works without it
    return () => {
      cancelled = true;
    };
  }, [residentAuthenticated]); // eslint-disable-line

  async function handleGenerateBills(period, force, onMessage) {
    if (!USE_API) {
      if (onMessage) onMessage("Bill generation requires the backend to be running.");
      else showToast("Bill generation requires the backend to be running.", "warn");
      return;
    }
    try {
      const result = await generateBills(period, force);
      await loadFromAPI(true);
      const msg = force
        ? `Recalculated ${result.created} new and updated ${result.updated} existing bills for ${period} with tiered pricing.`
        : `Generated ${result.created} bill(s) for ${period}${result.skipped ? ` — ${result.skipped} already billed` : "."}`;
      if (onMessage) {
        onMessage(msg);
      } else {
        showToast(msg, "success");
      }
    } catch (err) {
      const errMsg = "Could not generate bills: " + err.message;
      if (onMessage) {
        onMessage(errMsg);
      } else {
        showToast(errMsg, "warn");
      }
    }
  }

  // ── Mark paid ────────────────────────────────────────────────
  // paymentMethod is whichever the admin picked in the confirm modal —
  // "Offline" (cash, received in person) or "GCash" (recorded manually,
  // e.g. the resident paid but staff confirmed it by other means rather
  // than through the automatic PayMongo flow).
  async function markPaid(id, paymentMethod = "Offline", paymentStamp, paymentReference) {
    if (USE_API) {
      try {
        const household = households.find((h) => h.id === id);
        if (!household?.bill_id) throw new Error("No bill found for this household.");
        await recordCash(household.bill_id, household.totalDue, paymentMethod, paymentReference);
        await loadFromAPI(true); // refresh from backend
        return true;
      } catch (err) {
        showToast("Payment error: " + err.message, "warn");
        return false;
      }
    }

    if (paymentMethod === "GCash" && !/^[0-9]{1,80}$/.test(String(paymentReference || ""))) {
      showToast("Enter a numeric GCash reference before recording payment.", "warn");
      return false;
    }

    // Mock path
    setHouseholds((prev) =>
      prev.map((h) =>
        h.id === id
          ? { ...h, paymentStatus: "Paid", paymentMethod, paymentReference: paymentReference || h.paymentReference, paymentStamp: paymentStamp || h.paymentStamp }
          : h
      )
    );
    return true;
  }

  // Undo an accidental payment — reverts a Paid bill back to Unpaid.
  async function markUnpaid(id) {
    if (USE_API) {
      try {
        const household = households.find((h) => h.id === id);
        if (!household?.bill_id) throw new Error("No bill found for this household.");
        await recordUnpaid(household.bill_id);
        await loadFromAPI(true); // refresh from backend
        showToast("Payment reverted — bill marked unpaid.", "success");
      } catch (err) {
        showToast("Could not revert payment: " + err.message, "warn");
      }
      return;
    }

    // Mock path
    setHouseholds((prev) =>
      prev.map((h) =>
        h.id === id ? { ...h, paymentStatus: "Unpaid", paymentMethod: null } : h
      )
    );
  }

  async function receiveGcashPayment(id, reference) {
    if (USE_API) {
      try {
        const household = households.find((h) => h.id === id);
        if (!household?.bill_id) throw new Error("No bill found for this household.");
        await confirmGcash(household.bill_id, reference);
        await loadFromAPI(true); // refresh from backend
        showToast(`${id} GCash payment received and confirmed`, "success");
        return true;
      } catch (err) {
        showToast("GCash confirmation error: " + err.message, "warn");
        return false;
      }
    }

    const household = households.find((h) => h.id === id);
    if (household?.paymentReference && reference?.trim().toUpperCase() !== household.paymentReference.trim().toUpperCase()) {
      showToast("GCash confirmation error: the reference does not match the resident's submission.", "warn");
      return false;
    }
    // Mock path
    setHouseholds((prev) =>
      prev.map((h) =>
        h.id === id && h.paymentStatus === "GCash Pending"
          ? { ...h, paymentStatus: "Paid" }
          : h
      )
    );
    showToast(`${id} GCash payment received and confirmed`, "success");
    return true;
  }

  // Admin confirms cash they've physically received for a resident's
  // "Cash Pending" bill — the only way a cash payment ever becomes Paid.
  async function receiveCashPayment(id) {
    if (USE_API) {
      try {
        const household = households.find((h) => h.id === id);
        if (!household?.bill_id) throw new Error("No bill found for this household.");
        await confirmCash(household.bill_id);
        await loadFromAPI(true); // refresh from backend
        showToast(`${id} cash payment received and confirmed`, "success");
      } catch (err) {
        showToast("Cash confirmation error: " + err.message, "warn");
      }
      return;
    }

    // Mock path
    setHouseholds((prev) =>
      prev.map((h) =>
        h.id === id && h.paymentStatus === "Cash Pending"
          ? { ...h, paymentStatus: "Paid" }
          : h
      )
    );
    showToast(`${id} cash payment received and confirmed`, "success");
  }

  // Opening the confirmation modal — both the table row and the detail panel
  // route through these so resolving/unresolving always asks first. Unresolve
  // exists so an admin can undo an alert that was resolved by accident.
  function resolveAlert(id) {
    setConfirmAlert({ id, action: "resolve" });
  }

  function unresolveAlert(id) {
    setConfirmAlert({ id, action: "unresolve" });
  }

  async function performAlertAction(id, action) {
    setConfirmAlert(null);
    const resolving = action === "resolve";
    const nextStatus = resolving ? "Resolved" : "Unresolved";
    if (USE_API) {
      try {
        await (resolving ? resolveAlertApi(id) : unresolveAlertApi(id));
      } catch (err) {
        showToast(`Could not ${action} alert: ` + err.message, "warn");
        return;
      }
    }
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: nextStatus } : a)));
    showToast(`Alert marked as ${nextStatus.toLowerCase()}`, "success");
  }

  // ── Leak reports ─────────────────────────────────────────────
  async function resolveLeakReport(id) {
    const nextStatus = "Resolved";
    if (USE_API) {
      try {
        await resolveLeakReportApi(id);
      } catch (err) {
        showToast("Could not resolve report: " + err.message, "warn");
        return;
      }
    }
    setLeakReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    showToast("Leak report marked as resolved", "success");
  }

  async function reopenLeakReport(id) {
    const nextStatus = "Open";
    if (USE_API) {
      try {
        await unresolveLeakReportApi(id);
      } catch (err) {
        showToast("Could not reopen report: " + err.message, "warn");
        return;
      }
    }
    setLeakReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    showToast("Leak report reopened", "success");
  }

  // ── Payment (GCash or Cash) ─────────────────────────────────────
  // method: "gcash" (default, PayMongo checkout) or "cash" (declares intent
  // to pay in person — see confirmGcashPayment's "cash" branch below).
  function startGcashPayment(id, method = "gcash") {
    setPaymentModal(id);
    setPaymentStep("confirm");
  }

  async function confirmGcashPayment(reference) {
    setPaymentStep("processing");
    try {
      const household = households.find((h) => h.id === paymentModal);
      if (USE_API && !household?.bill_id) throw new Error("No bill found.");
      if (USE_API) {
        await submitGcashReference(household.bill_id, reference);
        await loadFromAPI(true);
      } else {
        const paymentReference = reference.trim();
        setHouseholds((prev) =>
          prev.map((h) =>
            h.id === paymentModal
              ? { ...h, paymentStatus: "GCash Pending", paymentMethod: "GCash", paymentReference }
              : h
          )
        );
      }
      setPaymentStep("gcash-pending");
      showToast("GCash reference submitted for admin verification.", "info");
    } catch (err) {
      setPaymentStep("confirm");
      showToast("Could not submit GCash reference: " + err.message, "warn");
    }
  }

  // Re-checks a pending PayMongo payment and marks it Paid if confirmed.
  // Used both by the automatic post-checkout return (below) and by a manual
  // "Check payment status" button, for cases like the resident closing the
  // PayMongo tab before the redirect completes. Resolves the bill by
  // household id server-side, so it works even before bill data is loaded.
  async function syncPendingPayment(householdId, { silent = false } = {}) {
    if (!USE_API || !householdId) return;
    try {
      const result = await syncGcashByHousehold(householdId, "resident");
      if (result.paid) {
        await loadFromAPI(true);
        showToast("Payment confirmed by PayMongo — thank you!", "success");
      } else if (!silent) {
        showToast("PayMongo hasn't confirmed this payment yet. Try again in a moment.", "info");
      }
      return result;
    } catch (err) {
      if (!silent) showToast("Could not check payment status: " + err.message, "warn");
    }
  }

  // Resident returns here after PayMongo checkout (success_url/cancel_url —
  // see server/src/routes/data.js). Sync immediately so the UI reflects the
  // real payment status without the resident needing to do anything.
  useEffect(() => {
    if (!USE_API || !residentAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const paidHousehold = params.get("paidHousehold");
    const cancelledHousehold = params.get("cancelledHousehold");
    if (!paidHousehold && !cancelledHousehold) return;

    // Strip the query string immediately so a refresh doesn't re-trigger this.
    window.history.replaceState(null, "", window.location.pathname);

    if (cancelledHousehold) {
      showToast("Payment was cancelled.", "info");
      return;
    }
    if (paidHousehold) {
      syncPendingPayment(paidHousehold);
    }
  }, [residentAuthenticated]); // eslint-disable-line

  const unpaidCount = households.filter((h) => h.paymentStatus === "Unpaid" || h.paymentStatus === "GCash Pending" || h.paymentStatus === "Cash Pending").length;
  const billsGenerated = households.length;

  if (loading) {
    return (
      <div className="w-full min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-sky-600 border-t-transparent rounded-full animate-spin" />
          Connecting to backend…
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-800" style={{ fontFamily: "'Source Sans 3', system-ui, sans-serif" }}>
      <style>{`
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
      `}</style>

      {view === "admin" ? (
        <AdminView
          households={households}
          alerts={alerts}
          unpaidCount={unpaidCount}
          billsGenerated={billsGenerated}
          page={adminPage}
          setPage={setAdminPage}
          adminAuthenticated={adminAuthenticated}
          onAdminLogin={handleAdminLogin}
          onAdminLogout={handleAdminLogout}
          onUpdateAdminProfile={handleUpdateAdminProfile}
          adminEmail={adminEmail}
          adminRole={adminRole}
          adminName={adminName}
          markPaid={markPaid}
          markUnpaid={markUnpaid}
          receiveGcashPayment={receiveGcashPayment}
          receiveCashPayment={receiveCashPayment}
          showToast={showToast}
          alertFilter={alertFilter}
          setAlertFilter={setAlertFilter}
          selectedAlertId={selectedAlertId}
          setSelectedAlertId={setSelectedAlertId}
          resolveAlert={resolveAlert}
          unresolveAlert={unresolveAlert}
          leakReports={leakReports}
          resolveLeakReport={resolveLeakReport}
          reopenLeakReport={reopenLeakReport}
          onResetResidentPassword={handleResetResidentPassword}
          onConfirmPasswordReset={handleConfirmPasswordReset}
          onGenerateBills={handleGenerateBills}
          onAddHousehold={handleAddHousehold}
          onProvisionDevice={handleProvisionDevice}
          onRevokeDevice={handleRevokeDevice}
          onSetDeviceCalibration={handleSetDeviceCalibration}
        />
      ) : (
        <ResidentView
          households={households}
          activeId={activeResidentId || (households[0]?.id ?? null)}
          setActiveId={setActiveResidentId}
          page={residentPage}
          setPage={setResidentPage}
          myAlerts={myAlerts}
          residentAuthenticated={residentAuthenticated}
          onResidentLogin={handleResidentLogin}
          onResidentGoogleLogin={handleResidentGoogleLogin}
          onResidentLogout={handleResidentLogout}
          residentLoginHouseholdId={residentLoginHouseholdId}
          onResidentLoginHouseholdSelect={setResidentLoginHouseholdId}
          startGcashPayment={startGcashPayment}
          syncPendingPayment={syncPendingPayment}
          onUpdateProfile={handleUpdateProfile}
          useApi={USE_API}
        />
      )}

      {paymentModal && (
        <GcashModal
          household={households.find((h) => h.id === paymentModal)}
          step={paymentStep}
          onConfirm={confirmGcashPayment}
          onClose={() => {
            setPaymentModal(null);
            setPaymentStep("confirm");
          }}
        />
      )}
      {confirmAlert && (() => {
        const alert = alerts.find((a) => a.id === confirmAlert.id);
        if (!alert) return null;
        const resolving = confirmAlert.action === "resolve";
        const verb = resolving ? "Resolve" : "Unresolve";
        return (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={() => setConfirmAlert(null)}
          >
            <div
              className="bg-white rounded-2xl w-80 overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="font-bold text-slate-800">{verb} alert?</div>
              </div>
              <div className="p-5 text-sm text-slate-600">
                <p className="mb-4">
                  Mark alert <span className="font-semibold text-slate-800">{alert.id}</span> for{" "}
                  <span className="font-semibold text-slate-800">{alert.householdId} — {alert.name}</span>{" "}
                  ({alert.type}) as {resolving ? "resolved" : "unresolved"}?
                </p>
                <div className="flex gap-2 justify-end">
                  <Btn onClick={() => setConfirmAlert(null)}>Cancel</Btn>
                  <Btn variant="primary" onClick={() => performAlertAction(alert.id, confirmAlert.action)}>{verb}</Btn>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      <Toast toast={toast} />
    </div>
  );
}