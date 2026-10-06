import React, { useState, useEffect } from "react";
import { Badge, StatCard, Btn } from "../ui/atoms";
import { SectionHeader } from "../components/SectionHeader";
import logoImage from "../assets/brgy.jpg";
import { BillReplica } from "../components/BillReplica";
import { GcashBillingSection } from "../components/GcashBilling";
import { ConsumptionStatusBanner } from "../components/ConsumptionStatusBanner";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { peso, MIN_BILL, formatDueDate, dueDateForPeriod, getConsumptionStatus, isOverdue, daysOverdue } from "../data";
import { submitLeakReport, residentForgotPassword, fetchAnnouncements } from "../api";
import { deviceStatus, DEVICE_STATUS_TICK_MS } from "../deviceStatus";

// ─────────────────────────────────────────────────────────────
// LOGIN — matches WaterSystemPrototype's handleResidentLogin contract:
//   onResidentLogin({ householdId, password, confirmPassword })
//     -> returns / resolves { success: boolean, message?: string }
// First-time login for a household (no password set yet) requires
// creating a strong password + confirming it. Returning residents
// just enter their existing password.
// ─────────────────────────────────────────────────────────────
function isStrongPassword(value) {
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

export function LoginScreen({
  households,
  onResidentLogin,
  onResidentGoogleLogin,
  residentLoginHouseholdId,
  onResidentLoginHouseholdSelect,
  useApi,
}) {
  const [mode, setMode] = useState("login"); // 'login' | 'forgot'
  // Residents now type their control number (household ID off the bill) instead
  // of picking their name from a list — better privacy, matches the printed bill.
  const [controlNumber, setControlNumber] = useState(residentLoginHouseholdId || "");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  // null = auto-detect from the household's real password state; otherwise
  // the resident has manually switched forms via the toggle link below.
  const [modeOverride, setModeOverride] = useState(null); // null | 'login' | 'create'

  // Resolve the typed control number to a household (case-insensitive).
  const normalizedControl = controlNumber.trim().toLowerCase();
  const selected = normalizedControl
    ? households.find((h) => h.id.toLowerCase() === normalizedControl) || null
    : null;
  const resolvedHouseholdId = selected ? selected.id : "";
  // Default to "sign up" when nothing's matched yet (mirrors the reference).
  const autoIsNewPassword = selected ? !selected.password : true;
  const isNewPassword = modeOverride ? modeOverride === "create" : autoIsNewPassword;
  const googleLinked = selected ? Boolean(selected.googleLinked) : false;

  const passwordChecks = [
    { label: "8+ characters", met: password.length >= 8 },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "A number", met: /[0-9]/.test(password) },
    { label: "A symbol", met: /[^A-Za-z0-9]/.test(password) },
  ];

  function handleControlChange(value) {
    setControlNumber(value);
    setError("");
    setInfo("");
    setModeOverride(null);
    const match = households.find((h) => h.id.toLowerCase() === value.trim().toLowerCase());
    if (match && typeof onResidentLoginHouseholdSelect === "function") {
      onResidentLoginHouseholdSelect(match.id);
    }
  }

  function toggleCreateMode() {
    setModeOverride(isNewPassword ? "login" : "create");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setInfo("");
  }

  async function handleLogin() {
    setError("");

    if (!controlNumber.trim()) {
      setError("Please enter your control number (found on your water bill).");
      return;
    }
    if (!selected) {
      setError("We couldn't find an account with that control number. Check your bill and try again.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    if (isNewPassword) {
      if (!firstName.trim() || !lastName.trim()) {
        setError("Please enter your first and last name.");
        return;
      }
      if (!isStrongPassword(password)) {
        setError(
          "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol."
        );
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await onResidentLogin({
        householdId: resolvedHouseholdId,
        password,
        confirmPassword,
        email: isNewPassword ? email : undefined,
        firstName: isNewPassword ? firstName : undefined,
        lastName: isNewPassword ? lastName : undefined,
        rememberMe,
      });
      if (!result || !result.success) {
        // The backend always checks the real account state, regardless of
        // which form the resident is looking at — if this household already
        // has a password, a "create password" submission is actually treated
        // as a login attempt and (correctly) rejected as "Incorrect password."
        // That's accurate but confusing here, since nothing in this form looks
        // like a login. Clarify what's actually going on instead.
        if (isNewPassword && result && result.message === "Incorrect password.") {
          setError(
            "This household already has a password set. Use \"Already set up? Sign in instead\" below — if you don't know the password, sign in there and use \"Forgot password?\"."
          );
        } else {
          setError((result && result.message) || "Login failed. Please try again.");
        }
      }
      if (rememberMe && result && result.success) {
        localStorage.setItem("residentRememberMe", "true");
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleCredential(credential) {
    if (!selected) {
      setError("Please enter your control number first, then sign in with Google.");
      return;
    }
    setError("");
    setGoogleSubmitting(true);
    try {
      const result = await onResidentGoogleLogin({ householdId: resolvedHouseholdId, credential });
      if (!result || !result.success) {
        setError((result && result.message) || "Google sign-in failed. Please try again.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setGoogleSubmitting(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleLogin();
  }

  if (mode === "forgot") {
    return (
      <ResidentForgotPasswordScreen
        households={households}
        initialHouseholdId={resolvedHouseholdId}
        onDone={(resetHouseholdId, message) => {
          setControlNumber(resetHouseholdId);
          setPassword("");
          setConfirmPassword("");
          setInfo(message);
          setMode("login");
        }}
        onCancel={() => setMode("login")}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-sm sm:max-w-md lg:max-w-lg">
        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition duration-300 hover:shadow-xl hover:border-slate-300 motion-safe:hover:-translate-y-1">
          {/* Header band */}
          <div className="bg-[#1e3a5f] px-6 py-7 sm:px-8 sm:py-9 text-center">
            <img
              src={logoImage}
              alt="Barangay Kinamlutan logo"
              className="mx-auto mb-3 h-16 w-16 sm:h-20 sm:w-20 rounded-full object-cover shadow-lg border-2 border-white/20"
            />
            <div className="font-extrabold text-white text-base sm:text-lg leading-tight">
              Barangay Kinamlutan
            </div>
            <div className="font-semibold text-sky-300 text-xs sm:text-sm mt-0.5">
              Water Billing & Monitoring System
            </div>
          </div>

          {/* Form */}
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="text-sm sm:text-base font-semibold text-slate-700 mb-1 text-center">
              {isNewPassword ? "Resident Sign Up" : "Resident Sign In"}
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mb-5 text-center">
              {isNewPassword
                ? "Register your household using the control number on your water bill."
                : "Enter your control number and password to continue."}
            </div>

            {info && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 mb-4 text-xs sm:text-[13px] text-emerald-700">
                {info}
              </div>
            )}

            {/* Error alert */}
            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2">
                <svg
                  className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span className="text-xs sm:text-[13px] text-rose-700">{error}</span>
              </div>
            )}

            {/* Email + Preferred Username — sign-up only */}
            {isNewPassword && (
              <>
                <div className="mb-3">
                  <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <input
                      type="email"
                      autoComplete="off"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                    />
                  </div>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                      First Name
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Juan"
                      value={firstName}
                      onChange={(e) => { setFirstName(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                    />
                  </div>
                  <div>
                    <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                      Last Name
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="dela Cruz"
                      value={lastName}
                      onChange={(e) => { setLastName(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Control Number (household ID from the bill) */}
            <div className="mb-3">
              <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                Control Number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="e.g., HH-001 (found on your water bill)"
                  value={controlNumber}
                  onChange={(e) => handleControlChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                />
              </div>
              {selected && (
                <div className="text-xs sm:text-[13px] text-emerald-600 mt-1 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {selected.name} · Standpost #{selected.standpost}
                </div>
              )}
            </div>

            {/* Password */}
            <div className={isNewPassword ? "mb-3" : "mb-5"}>
              <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                {isNewPassword ? "Create Password" : "Password"}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg
                    className="w-4 h-4 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={isNewPassword ? "new-password" : "current-password"}
                  placeholder={isNewPassword ? "Create a strong password" : "Your password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full border border-slate-300 rounded-lg pl-9 pr-10 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
              {isNewPassword && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
                  {passwordChecks.map((check) => (
                    <div key={check.label} className="flex items-center gap-1.5">
                      {check.met ? (
                        <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-slate-300 flex-shrink-0" />
                      )}
                      <span className={`text-xs sm:text-[13px] ${check.met ? "text-emerald-600" : "text-slate-400"}`}>
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!isNewPassword && (
                <>
                  <div className="mt-3 mb-3 flex items-center gap-2">
                    <input
                      id="resident-remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f] cursor-pointer"
                    />
                    <label htmlFor="resident-remember-me" className="text-xs sm:text-[13px] text-slate-600 cursor-pointer">
                      Remember me
                    </label>
                  </div>
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => { setError(""); setInfo(""); setMode("forgot"); }}
                      className="text-xs sm:text-[13px] text-sky-600 hover:text-sky-800 font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Confirm password — only for first-time setup */}
            {isNewPassword && (
              <div className="mb-5">
                <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg
                      className="w-4 h-4 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                  <input
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError("");
                    }}
                    onKeyDown={handleKeyDown}
                    className="w-full border border-slate-300 rounded-lg pl-9 pr-10 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                  >
                    {showConfirm ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleLogin}
              disabled={submitting || googleSubmitting}
              className={`w-full text-white text-sm sm:text-base font-semibold py-2.5 sm:py-3 rounded-lg transition active:scale-[0.98] ${
                submitting || googleSubmitting
                  ? "bg-slate-400 cursor-not-allowed"
                  : "bg-[#1e3a5f] hover:bg-[#16304f]"
              }`}
            >
              {submitting
                ? "Please wait…"
                : isNewPassword
                ? "Register Account"
                : "Sign In"}
            </button>

            <div className="text-center mt-3">
              <button
                type="button"
                onClick={toggleCreateMode}
                className="text-xs sm:text-[13px] text-sky-600 hover:text-sky-800 font-medium inline-flex items-center gap-1"
              >
                {isNewPassword ? "Already have an account? Sign in instead" : "New here? Create an account"}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
                </svg>
              </button>
            </div>

            {/* Google Sign-In — only shown when API is connected */}
            {useApi && typeof onResidentGoogleLogin === "function" && (
              <>
                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs sm:text-[13px] text-slate-400 font-medium">
                    {googleLinked ? "or sign in with" : "or link & sign in with"}
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Google button */}
                {googleSubmitting ? (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs sm:text-sm text-slate-500">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-sky-600 rounded-full animate-spin" />
                    Verifying with Google…
                  </div>
                ) : (
                  <GoogleSignInButton
                    onCredential={handleGoogleCredential}
                    onError={(msg) => setError(msg)}
                    disabled={submitting}
                    text={googleLinked ? "signin_with" : "continue_with"}
                  />
                )}

                {/* Contextual hint */}
                <div className="text-[10px] sm:text-xs text-slate-400 text-center mt-2">
                  {googleLinked
                    ? `Linked to ${selected.googleEmail || "a Google account"}`
                    : "Signing in with Google will link it to this household."}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-4 text-xs sm:text-[13px] text-slate-400">
          Barangay Kinamlutan, Butuan City · ZIP 8600
        </div>
        <div className="text-center mt-2 text-xs sm:text-[13px] text-slate-500">
          Barangay staff?{" "}
          <a href="/admin" className="text-sky-600 hover:text-sky-800 font-medium">
            Go to the admin portal
          </a>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FORGOT PASSWORD (resident) — files a request for an admin to handle.
// No verification code: the resident just asks, and an admin sets and
// confirms the new password directly from the Household Records page.
// ─────────────────────────────────────────────────────────────
function ResidentForgotPasswordScreen({ households, initialHouseholdId, onDone, onCancel }) {
  const [householdId, setHouseholdId] = useState(
    initialHouseholdId || (households[0] && households[0].id) || ""
  );
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(e) {
    e.preventDefault();
    setError("");
    if (!householdId) {
      setError("Please select your household / standpost.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await residentForgotPassword(householdId);
      if (!result.success) {
        setError(result.message || "Could not send your request.");
        return;
      }
      setRequested(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-sm sm:max-w-md lg:max-w-lg">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition duration-300 hover:shadow-xl hover:border-slate-300 motion-safe:hover:-translate-y-1">
          <div className="bg-[#1e3a5f] px-6 py-7 sm:px-8 sm:py-9 text-center">
            <img
              src={logoImage}
              alt="Barangay Kinamlutan logo"
              className="mx-auto mb-3 h-16 w-16 sm:h-20 sm:w-20 rounded-full object-cover shadow-lg border-2 border-white/20"
            />
            <div className="font-extrabold text-white text-base sm:text-lg leading-tight">
              Barangay Kinamlutan
            </div>
            <div className="font-semibold text-sky-300 text-xs sm:text-sm mt-0.5">
              Water Billing & Monitoring System
            </div>
          </div>

          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="text-sm sm:text-base font-semibold text-slate-700 mb-1 text-center">
              Reset Password
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mb-5 text-center">
              {requested
                ? "Your request is on its way."
                : "Select your household — an admin will set your new password and confirm it. No code needed."}
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 mb-4 text-xs sm:text-[13px] text-rose-700">
                {error}
              </div>
            )}

            {!requested ? (
              <form onSubmit={handleRequest}>
                <div className="mb-5">
                  <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                    Household / Standpost
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                        />
                      </svg>
                    </div>
                    <select
                      value={householdId}
                      onChange={(e) => setHouseholdId(e.target.value)}
                      className="w-full appearance-none border border-slate-300 rounded-lg pl-9 pr-8 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition bg-white"
                    >
                      {households.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.id} · {h.name} (Standpost #{h.standpost})
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full text-white text-sm sm:text-base font-semibold py-2.5 sm:py-3 rounded-lg transition active:scale-[0.98] ${
                    submitting ? "bg-slate-400 cursor-not-allowed" : "bg-[#1e3a5f] hover:bg-[#16304f]"
                  }`}
                >
                  {submitting ? "Sending…" : "Send Request to Admin"}
                </button>
              </form>
            ) : (
              <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-5 text-center">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-sm sm:text-base font-semibold text-slate-700 mb-1">Request sent</div>
                <div className="text-xs sm:text-[13px] text-slate-500 mb-4">
                  An admin will set your new password and confirm it. Check back and sign in once they've done that.
                </div>
                <button
                  type="button"
                  onClick={() => onDone(householdId, "Password reset requested — an admin will set your new password.")}
                  className="w-full text-white text-sm sm:text-base font-semibold py-2.5 sm:py-3 rounded-lg bg-[#1e3a5f] hover:bg-[#16304f] transition active:scale-[0.98]"
                >
                  Back to Sign In
                </button>
              </div>
            )}

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onCancel}
                className="text-xs sm:text-[13px] text-slate-500 hover:text-slate-700 font-medium"
              >
                ← Back to sign in
              </button>
            </div>
          </div>
        </div>

        <div className="text-center mt-4 text-xs sm:text-[13px] text-slate-400">
          Barangay Kinamlutan, Butuan City · ZIP 8600
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
// Live flow-sensor reading — updates on its own (no refresh needed) since
// `me` comes from shared state that an open SSE connection keeps current
// the instant the household's ESP reports in (see WaterSystemPrototype.jsx).
function LiveUsageCard({ me }) {
  // Re-render periodically so Online ages into Offline even when the meter
  // goes quiet (which sends no event). Status thresholds: src/deviceStatus.js.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), DEVICE_STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const status = deviceStatus(me);
  const connected = status.online;
  const flowing = connected && (me.lastFlow || 0) > 0;
  const isHighFlow = connected && me.flowType === "High flow";

  return (
    <div className="card-hover bg-white rounded-lg border border-slate-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-[13px] text-slate-700">Live water usage</div>
        <span className={`text-[11px] font-medium ${status.tone}`}>{status.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-lg p-3 ${isHighFlow ? "bg-amber-50" : flowing ? "bg-sky-50" : "bg-slate-50"}`}>
          <div className="text-[10px] text-slate-500 mb-0.5">Current flow rate</div>
          {connected ? (
            <div className={`text-xl font-bold ${isHighFlow ? "text-amber-700" : flowing ? "text-sky-700" : "text-slate-600"}`}>
              {(me.lastFlow || 0).toFixed(1)} <span className="text-xs font-medium">L/min</span>
            </div>
          ) : (
            <div className="text-xl font-bold text-slate-400">— <span className="text-xs font-medium">L/min</span></div>
          )}
          {isHighFlow && <div className="text-[10px] text-amber-600 font-medium mt-0.5">High flow detected</div>}
        </div>
        <div className="rounded-lg p-3 bg-slate-50">
          <div className="text-[10px] text-slate-500 mb-0.5">Meter reading</div>
          <div className="text-xl font-bold text-slate-700">
            {me.currCm3} <span className="text-xs font-medium">CM³</span>
          </div>
        </div>
      </div>
      {!connected && (
        <p className="text-[11px] text-slate-400 mt-2.5">
          {me.deviceProvisioned && me.deviceLastSeen
            ? "Smart meter offline — live usage resumes when it reconnects. Your meter reading above is the last one received."
            : me.deviceProvisioned
            ? "Smart meter registered — waiting for its first reading."
            : "No smart meter connected yet — your bill is based on manual readings until one's installed."}
        </p>
      )}
    </div>
  );
}

export function ResidentDashboard({ me, setPage, alerts = [] }) {
  const maxConsumption = Math.max(...me.history.map((h) => h.curr - h.prev), 1);

  return (
    <>
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Household {me.id} · Standpost #{me.standpost} · Meter {me.meter}
          </p>
        </div>
        <div className="text-xs text-slate-400">Barangay Kinamlutan, Butuan City</div>
      </div>

      <ConsumptionStatusBanner me={me} />

      <LiveUsageCard me={me} />

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 mb-5 sm:grid-cols-4">
        <StatCard label="This month (May)" value={`${me.consumption} CM³`} />
        <StatCard label="Amount due" value={peso(me.amount)} tone="bad" />
        <StatCard label="Previous balance" value={peso(me.prevBalance)} />
        <StatCard label="Total due" value={peso(me.totalDue)} tone="bad" />
      </div>

      {/* Bar chart */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 p-4 mb-4">
        <div className="font-semibold text-[13px] text-slate-700 mb-3">
          Monthly consumption (CM³)
        </div>
        <div className="flex items-end gap-2.5 h-32">
          {me.history.map((rec, i) => {
            const val = rec.curr - rec.prev;
            const heightPct = Math.min((val / maxConsumption) * 100, 100);
            const isLast = i === me.history.length - 1;
            return (
              <div
                key={rec.period}
                className="flex-1 flex flex-col items-center justify-end h-full"
              >
                <div className="text-[9px] text-slate-400 mb-1">{val}</div>
                <div
                  className={`w-full rounded-t-sm transition-all duration-700 ${
                    isLast ? "bg-amber-400" : "bg-sky-700"
                  }`}
                  style={{ height: `${heightPct}%`, minHeight: "6px" }}
                />
                <div className="text-[9px] text-slate-500 mt-1">
                  {rec.period.split(" ")[0]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <button
          onClick={() => setPage("bills")}
          className="card-hover bg-white rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-sky-400 hover:shadow-sm transition group"
        >
          <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center mb-2 group-hover:bg-sky-100 transition">
            <svg className="w-4 h-4 text-sky-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="text-[12px] font-semibold text-slate-700">View Bills</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Current statement</div>
        </button>
        <button
          onClick={() => setPage("payments")}
          className="card-hover bg-white rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-sky-400 hover:shadow-sm transition group"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mb-2 group-hover:bg-emerald-100 transition">
            <svg className="w-4 h-4 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div className="text-[12px] font-semibold text-slate-700">Pay Bill</div>
          <div className="text-[10px] text-slate-400 mt-0.5">via GCash</div>
        </button>
        <button
          onClick={() => setPage("leak")}
          className="card-hover bg-white rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-rose-400 hover:shadow-sm transition group"
        >
          <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center mb-2 group-hover:bg-rose-100 transition">
            <svg className="w-4 h-4 text-rose-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="text-[12px] font-semibold text-slate-700">Report Leak</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Send alert</div>
        </button>
      </div>

      {/* Recent flow alerts — real-time device detection (leak / high flow /
          no sensor data), independent of the per-cycle usage banner above,
          which only updates once a bill is generated. Hidden entirely when
          there's nothing to show, so most residents never see an empty card. */}
      {alerts.length > 0 && (
        <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-2.5 text-[13px] font-semibold text-slate-700 border-b border-slate-100">
            Recent flow alerts
          </div>
          <div className="divide-y divide-slate-100">
            {alerts.slice(0, 5).map((a) => (
              <div key={a.id} className="px-4 py-2.5 flex items-center justify-between text-[12px]">
                <div>
                  <span
                    className={
                      a.type === "Leak Detected" ? "text-rose-600 font-medium"
                        : a.type === "High Flow" ? "text-amber-600 font-medium"
                        : "text-slate-500 font-medium"
                    }
                  >
                    {a.type}
                  </span>
                  <span className="text-slate-400 ml-2">{a.time}</span>
                </div>
                {a.status === "Unresolved" ? (
                  <Badge tone="bad">Unresolved</Badge>
                ) : (
                  <Badge tone="good">Resolved</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing history table */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 text-[13px] font-semibold text-slate-700 border-b border-slate-100 flex items-center justify-between">
          Billing history
          <button
            onClick={() => setPage("bills")}
            className="text-[11px] text-sky-600 hover:underline font-normal"
          >
            View all →
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[460px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left px-3 py-2 font-medium">Period</th>
              <th className="text-right px-3 py-2 font-medium">Prev CM³</th>
              <th className="text-right px-3 py-2 font-medium">Curr CM³</th>
              <th className="text-right px-3 py-2 font-medium">Bill (₱)</th>
              <th className="text-right px-3 py-2 font-medium">Total Due</th>
              <th className="text-center px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {me.history.map((rec, i) => {
              const isLast = i === me.history.length - 1;
              const status = isLast ? me.paymentStatus : "Paid";
              return (
                <tr key={rec.period} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                  <td className="px-3 py-1.5 font-medium text-slate-700">{rec.period}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{rec.prev}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{rec.curr}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{peso(rec.amt)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-800">
                    {peso(isLast ? me.totalDue : rec.amt)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {status === "Paid" ? (
                      <Badge tone="good">Paid</Badge>
                    ) : (
                      <Badge tone="bad">Unpaid</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// MY BILLS  (matches the screenshot layout exactly)
// ─────────────────────────────────────────────────────────────
export function ResidentBills({ me, setPage, startGcashPayment }) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Build billing periods from history + unpaid balance data
  const billingPeriods = me.history
    .slice()
    .reverse()
    .map((rec, i) => {
      const isLatest = i === 0;
      const consumed = rec.curr - rec.prev;
      return {
        label: rec.period,
        tag: isLatest ? "Current" : null,
        dueDate: isLatest ? formatDueDate(dueDateForPeriod(rec.period)) : null,
        paidDate: !isLatest
          ? `${rec.period.split(" ")[0].slice(0, 3)} ${parseInt(rec.period.split(" ")[0]) || 20}, ${rec.period.split(" ")[1]}`
          : null,
        amount: rec.amt,
        paid: !isLatest || me.paymentStatus === "Paid",
        rec,
        consumed,
      };
    });

  const selected = billingPeriods[selectedIdx];

  return (
    <>
      {/* Page header + breadcrumb */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">My Bills</h1>
          <p className="text-xs text-slate-500 mt-0.5">View and manage your water bills</p>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-1">
          <button
            onClick={() => setPage("dashboard")}
            className="text-[#1e3a5f] hover:underline flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            Home
          </button>
          <span>/</span>
          <span>My Bills</span>
        </div>
      </div>

      <div className="flex gap-4">
        {/* ── Left: period selector ── */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-3">
          <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="text-[13px] font-semibold text-slate-700">Select Billing Period</div>
            </div>
            <div className="divide-y divide-slate-100">
              {billingPeriods.map((period, idx) => (
                <button
                  key={period.label}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full text-left px-4 py-3 flex items-start justify-between transition border-l-4 ${
                    selectedIdx === idx
                      ? "bg-sky-50 border-[#1e3a5f]"
                      : "hover:bg-slate-50 border-transparent"
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className="text-[13px] font-semibold text-slate-800">
                        {period.label}
                      </span>
                      {period.tag && (
                        <span className="text-[10px] bg-sky-100 text-sky-700 font-semibold px-1.5 py-0.5 rounded">
                          {period.tag}
                        </span>
                      )}
                      {period.paid && !period.tag && (
                        <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-1.5 py-0.5 rounded">
                          Paid
                        </span>
                      )}
                    </div>
                    {period.dueDate && !period.paid && (
                      <div className="text-[11px] text-rose-500 font-medium">
                        Due: {period.dueDate}
                      </div>
                    )}
                    {period.paid && period.tag && (
                      <div className="text-[11px] text-emerald-600 font-medium">Paid</div>
                    )}
                    {!period.tag && (
                      <div className="text-[11px] text-slate-400">
                        Paid on {period.label.split(" ")[0].slice(0, 3)} 20,{" "}
                        {period.label.split(" ")[1]}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <span className="text-[13px] font-bold text-slate-700">
                      ₱{period.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                    </span>
                    <svg
                      className="w-4 h-4 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Need help card */}
          <div className="card-hover bg-white rounded-lg border border-slate-200 px-4 py-3 flex gap-2">
            <svg
              className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18 9a6 6 0 01-6 6H6l-4 4V9a6 6 0 016-6h6a6 6 0 016 6z"
              />
            </svg>
            <div>
              <div className="text-[12px] font-semibold text-slate-700">Need help?</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                If you have any questions regarding your bill, please contact the barangay office.
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: bill display ── */}
        <div className="flex-1 min-w-0">
          {/* Action bar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setSelectedIdx(Math.min(billingPeriods.length - 1, selectedIdx + 1))}
              className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 transition"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back to Bills
            </button>
            <div className="ml-auto flex gap-2 flex-wrap">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
                Download PDF
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-[12px] font-medium text-white bg-[#1e3a5f] rounded-md px-3 py-1.5 hover:bg-[#16304f] transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                  />
                </svg>
                Print
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-[12px] font-medium text-white bg-emerald-600 rounded-md px-3 py-1.5 hover:bg-emerald-700 transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download Receipt
              </button>
            </div>
          </div>

          {/* Bill document */}
          <div className="print-area">
            <BillReplica me={me} period={selected} />
          </div>

          {/* Pay by GCash QR for the current unpaid bill */}
          {selectedIdx === 0 && me.paymentStatus === "Unpaid" && (
            <div className="mt-3">
              <button
                onClick={() => startGcashPayment(me.id)}
                className="w-full flex items-center justify-center gap-2 bg-[#0072CE] hover:bg-[#005ea3] text-white font-semibold text-sm py-2.5 rounded-lg transition"
              >
                Pay with GCash QR
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}


// ─────────────────────────────────────────────────────────────
// PAYMENT HISTORY  (was "Make Payment" — now shows history + pay option)
// ─────────────────────────────────────────────────────────────
export function ResidentPayments({ me, startGcashPayment }) {
  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">Payment History</h1>
        <p className="text-xs text-slate-500 mt-0.5">All your payment records and pay your current bill</p>
      </div>

        {/* A submitted QR payment reference remains pending until an admin verifies it. */}
      {me.paymentStatus === "GCash Pending" && (
        <div className="rounded-lg px-4 py-3 mb-4 flex items-center justify-between border bg-sky-50 border-sky-200">
          <div>
            <div className="text-[13px] font-semibold text-sky-800">Waiting for admin verification</div>
            <div className="text-xs mt-0.5 text-sky-700">
              GCash reference <span className="font-semibold">{me.paymentReference || "submitted"}</span> for{" "}
              <span className="font-bold"> {peso(me.totalDue)}</span> is under review.
            </div>
          </div>
        </div>
      )}

      {/* Cash Pending — resident declared intent to pay in person, waiting on
          an admin to confirm they've actually received the cash. */}
      {me.paymentStatus === "Cash Pending" && (
        <div className="rounded-lg px-4 py-3 mb-4 flex items-center justify-between border bg-amber-50 border-amber-200">
          <div>
            <div className="text-[13px] font-semibold text-amber-800">Cash payment pending confirmation</div>
            <div className="text-xs mt-0.5 text-amber-700">
              Bring <span className="font-bold">{peso(me.totalDue)}</span> to the barangay office — an admin will
              mark this Paid once they've received it.
            </div>
          </div>
        </div>
      )}

      {/* Pay now banner if unpaid — turns red once the bill is past due */}
      {me.paymentStatus === "Unpaid" && (
        <div className={`rounded-lg px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border ${isOverdue(me) ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
          <div>
            <div className={`text-[13px] font-semibold ${isOverdue(me) ? "text-red-800" : "text-amber-800"}`}>
              {isOverdue(me)
                ? `Overdue — ${daysOverdue(me.dueDate, me.paymentStatus)} day${daysOverdue(me.dueDate, me.paymentStatus) === 1 ? "" : "s"} past due`
                : "Outstanding balance"}
            </div>
            <div className={`text-xs mt-0.5 ${isOverdue(me) ? "text-red-700" : "text-amber-700"}`}>
              You have an unpaid bill of{" "}
              <span className="font-bold">{peso(me.totalDue)}</span>
              {isOverdue(me) ? " that is now past its due date." : " due this period."}
            </div>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            <button
              onClick={() => startGcashPayment(me.id)}
              className="flex items-center gap-1.5 bg-[#0072CE] text-white text-[12px] font-semibold px-3 py-2 rounded-lg hover:bg-[#005ea3] transition"
            >
              Pay with GCash QR
            </button>
          </div>
        </div>
      )}

      {me.paymentStatus === "Paid" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            ✓
          </div>
          <div>
            <div className="text-[13px] font-semibold text-emerald-800">Account is current</div>
            <div className="text-xs text-emerald-700 mt-0.5">
              Your latest bill has been paid. No outstanding balance.
            </div>
          </div>
        </div>
      )}

      {/* GCash payment section */}
      <div className="max-w-xl mb-5">
        <GcashBillingSection me={me} onPay={startGcashPayment} />
      </div>

      {/* Payment history table */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 text-[13px] font-semibold text-slate-700 border-b border-slate-100">
          Transaction History
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[380px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left px-3 py-2 font-medium">Period</th>
              <th className="text-right px-3 py-2 font-medium">Amount</th>
              <th className="text-center px-3 py-2 font-medium">Method</th>
              <th className="text-center px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {me.history.map((rec, i) => {
              const isLast = i === me.history.length - 1;
              const status = isLast ? me.paymentStatus : "Paid";
              const method = isLast ? me.paymentMethod : i % 2 === 0 ? "GCash" : "Cash";
              return (
                <tr key={rec.period} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                  <td className="px-3 py-2 font-medium text-slate-700">{rec.period}</td>
                  <td className="px-3 py-2 text-right text-slate-700 font-semibold">
                    {peso(rec.amt)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {status === "Paid" || status === "GCash Pending" ? (
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                          method === "GCash" || status === "GCash Pending"
                            ? "bg-sky-50 text-sky-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {method || (status === "GCash Pending" ? "GCash" : "—")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {status === "Paid" ? (
                      <Badge tone="good">Paid</Badge>
                    ) : status === "GCash Pending" ? (
                      <Badge tone="info">Pending verification</Badge>
                    ) : status === "Cash Pending" ? (
                      <Badge tone="warn">Cash pending</Badge>
                    ) : (
                      <Badge tone="bad">Unpaid</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// MY PROFILE
// ─────────────────────────────────────────────────────────────
export function ResidentProfile({ me, onUpdateProfile }) {
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: me.name,
    address: me.address || `Purok ${me.standpost % 9 || 5} Kinamlutan, Butuan City`,
    phone: me.phone || "(09XX) XXX-XXXX",
    email: me.email || `${me.name.split(" ")[0].toLowerCase()}@gmail.com`,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");

    if (newPassword) {
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      if (!currentPassword) {
        setError("Enter your current password to set a new one.");
        return;
      }
    }

    if (typeof onUpdateProfile !== "function") {
      setEditing(false);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setTimeout(() => setSaved(false), 3000);
      return;
    }

    setSaving(true);
    try {
      const result = await onUpdateProfile(me.id, {
        ...formData,
        currentPassword: newPassword ? currentPassword : undefined,
        newPassword: newPassword || undefined,
      });
      if (!result || !result.success) {
        setError((result && result.message) || "Could not save your changes. Please try again.");
        return;
      }
      setEditing(false);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">My Profile</h1>
        <p className="text-xs text-slate-500 mt-0.5">Your household account information</p>
      </div>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 mb-4 text-[12px] text-emerald-800 font-medium">
          ✓ Profile information updated successfully.
        </div>
      )}

      {/* Account info card */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-700">Account Details</div>
          <button
            onClick={() => {
              setEditing(!editing);
              setCurrentPassword("");
              setNewPassword("");
              setError("");
            }}
            className="text-[12px] text-sky-600 hover:text-sky-800 font-medium"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
        <div className="px-4 py-4 space-y-4">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
              {me.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div className="font-bold text-slate-800">{me.name}</div>
              <div className="text-[11px] text-slate-500">Household ID: {me.id}</div>
              <div className="text-[11px] text-slate-500">Resident since 2024</div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
            {[
              { label: "Full Name", key: "name" },
              { label: "Address", key: "address" },
              { label: "Phone Number", key: "phone" },
              { label: "Email Address", key: "email" },
            ].map((field) => (
              <div key={field.key}>
                <label className="text-[11px] text-slate-500 block mb-1">{field.label}</label>
                {editing ? (
                  <input
                    type="text"
                    autoComplete="off"
                    value={formData[field.key]}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                  />
                ) : (
                  <div className="text-[13px] font-medium text-slate-800">{formData[field.key]}</div>
                )}
              </div>
            ))}
          </div>

          {editing && (
            <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] text-slate-500 block mb-1">New Password <span className="text-slate-400">(leave blank to keep current)</span></label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                />
              </div>
              {newPassword && (
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">Current Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                  />
                </div>
              )}
            </div>
          )}

          {editing && (
            <div className="pt-2 space-y-2">
              {error && (
                <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-[#1e3a5f] text-white text-[12px] font-semibold px-4 py-2 rounded-lg hover:bg-[#16304f] transition disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Meter info card */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[13px] font-semibold text-slate-700">Meter & Connection Info</div>
        </div>
        <div className="px-4 py-4 grid grid-cols-2 gap-4 text-[12px]">
          {[
            { label: "Meter Number", value: me.meter },
            { label: "Standpost Number", value: `#${me.standpost}` },
            { label: "Date of Connection", value: formatDueDate(me.dateConnected) },
            { label: "Rate", value: "₱20.00 per CM²" },
            { label: "Minimum Bill", value: "₱200.00" },
            { label: "Account Status", value: me.paymentStatus === "Paid" ? "Active - Current" : "Active - With Balance" },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-[11px] text-slate-500 mb-0.5">{item.label}</div>
              <div className="font-semibold text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// USAGE HISTORY  (Consumption)
// ─────────────────────────────────────────────────────────────
export function ResidentConsumption({ me }) {
  const maxVal = Math.max(...me.history.map((r) => r.curr - r.prev), 1);
  const status = getConsumptionStatus(me);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">Usage History</h1>
        <p className="text-xs text-slate-500 mt-0.5">Your household's billing-cycle consumption over time</p>
      </div>

      <ConsumptionStatusBanner me={me} />

      <LiveUsageCard me={me} />

      <div className="grid grid-cols-2 gap-3 mb-5 sm:grid-cols-4">
        <StatCard label="Previous reading" value={`${me.prevCm3} CM³`} />
        <StatCard label="Current reading" value={`${me.currCm3} CM³`} />
        <StatCard
          label="This cycle"
          value={`${me.consumption} CM³`}
          tone={status.tone}
        />
        <StatCard label="Last recorded flow" value={me.deviceProvisioned && me.deviceLastSeen ? `${me.lastFlow} L/min` : "No sensor"} />
      </div>

      {status.level === "high" && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800 flex gap-2 mb-4">
          <span>⚠</span>
          <span>
            Your usage this cycle is well above your average. If you didn't leave any taps
            running, check your pipes for possible leaks.
          </span>
        </div>
      )}

      {/* Bar chart */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 p-4 mb-4">
        <div className="font-semibold text-[13px] text-slate-700 mb-3">
          Consumption history (CM³)
        </div>
        <div className="flex items-end gap-3 h-32">
          {me.history.map((rec, i) => {
            const val = rec.curr - rec.prev;
            const isLast = i === me.history.length - 1;
            return (
              <div
                key={rec.period}
                className="flex-1 flex flex-col items-center justify-end h-full"
              >
                <div className="text-[9px] text-slate-400 mb-1">{val}</div>
                <div
                  className={`w-full rounded-t-sm ${isLast ? "bg-amber-400" : "bg-sky-700"}`}
                  style={{
                    height: `${Math.min((val / maxVal) * 100, 100)}%`,
                    minHeight: "6px",
                  }}
                />
                <div className="text-[9px] text-slate-500 mt-1">
                  {rec.period.split(" ")[0]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed history table */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 text-[13px] font-semibold text-slate-700 border-b border-slate-100">
          Monthly Breakdown
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[460px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left px-3 py-2 font-medium">Period</th>
              <th className="text-right px-3 py-2 font-medium">Prev (CM³)</th>
              <th className="text-right px-3 py-2 font-medium">Curr (CM³)</th>
              <th className="text-right px-3 py-2 font-medium">Used (CM³)</th>
              <th className="text-right px-3 py-2 font-medium">Bill (₱)</th>
              <th className="text-center px-3 py-2 font-medium">vs Avg</th>
            </tr>
          </thead>
          <tbody>
            {me.history.map((rec, i) => {
              const used = rec.curr - rec.prev;
              const allUsed = me.history.map((r) => r.curr - r.prev);
              const avg = allUsed.reduce((s, v) => s + v, 0) / allUsed.length;
              const ratio = used / avg;
              const tone =
                ratio >= 1.5 ? "bad" : ratio >= 1.2 ? "warn" : "good";
              const label =
                ratio >= 1.5 ? "High" : ratio >= 1.2 ? "Above avg" : "Normal";
              return (
                <tr key={rec.period} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                  <td className="px-3 py-2 font-medium text-slate-700">{rec.period}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{rec.prev}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{rec.curr}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-700">{used}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{peso(rec.amt)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────────────────────
const ANNOUNCEMENTS = [
  {
    id: 1,
    type: "info",
    title: "Scheduled Maintenance – Water Interruption",
    date: "June 25, 2026",
    content:
      "There will be a scheduled water interruption on June 28, 2026 (Saturday) from 8:00 AM to 5:00 PM to allow for pipeline maintenance in Purok 3 and Purok 5. Please store enough water for your household's needs. We apologize for any inconvenience.",
    tag: "Maintenance",
  },
  {
    id: 2,
    type: "success",
    title: "New Online Payment Now Available",
    date: "June 15, 2026",
    content:
      "Residents can now pay their water bills online using GCash directly through this portal. Go to Payment History and click 'Pay Now' to settle your current balance. No need to visit the barangay office.",
    tag: "Service Update",
  },
  {
    id: 3,
    type: "warn",
    title: "Water Conservation Advisory",
    date: "June 10, 2026",
    content:
      "Due to the current dry season, we encourage all households to conserve water usage. Limit watering of plants and car washing during peak hours (6 AM – 9 AM and 5 PM – 8 PM). Households exceeding 50 CM³ per cycle may be flagged for inspection.",
    tag: "Advisory",
  },
  {
    id: 4,
    type: "info",
    title: "New IoT Flow Sensors Installed",
    date: "May 30, 2026",
    content:
      "Barangay Kinamlutan has successfully installed IoT-based water flow sensors for all connected households. These sensors automatically track your consumption and detect unusual flow patterns that may indicate leaks. Your readings are updated in real time on this portal.",
    tag: "Technology",
  },
];

// Fallback used only if the backend can't be reached — keeps the page useful
// offline. Normally the list comes live from GET /api/announcements.
const FALLBACK_ANNOUNCEMENTS = ANNOUNCEMENTS;

function formatAnnDate(value) {
  if (!value) return "";
  // API sends "YYYY-MM-DD"; anchor to local midnight so the day doesn't shift.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T00:00:00") : new Date(value);
  return isNaN(d) ? value : d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

export function ResidentAnnouncements() {
  const [expanded, setExpanded] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchAnnouncements()
      .then((data) => { if (active) setList(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setList(FALLBACK_ANNOUNCEMENTS); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const typeStyles = {
    info: {
      wrap: "border-sky-200 bg-sky-50",
      icon: "text-sky-600 bg-sky-100",
      badge: "bg-sky-100 text-sky-700",
      dot: "bg-sky-500",
    },
    success: {
      wrap: "border-emerald-200 bg-emerald-50",
      icon: "text-emerald-600 bg-emerald-100",
      badge: "bg-emerald-100 text-emerald-700",
      dot: "bg-emerald-500",
    },
    warn: {
      wrap: "border-amber-200 bg-amber-50",
      icon: "text-amber-600 bg-amber-100",
      badge: "bg-amber-100 text-amber-700",
      dot: "bg-amber-500",
    },
  };

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">Announcements</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Latest news and updates from the barangay water office
        </p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-slate-400">Loading announcements…</div>
      ) : list.length === 0 ? (
        <div className="card-hover bg-white rounded-lg border border-slate-200 py-10 text-center text-xs text-slate-400">
          No announcements at the moment.
        </div>
      ) : (
      <div className="space-y-3">
        {list.map((ann) => {
          const style = typeStyles[ann.type] || typeStyles.info;
          const isOpen = expanded === ann.id;
          return (
            <div
              key={ann.id}
              className={`rounded-lg border ${style.wrap} overflow-hidden`}
            >
              <button
                onClick={() => setExpanded(isOpen ? null : ann.id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3"
              >
                <div
                  className={`w-7 h-7 rounded-full ${style.icon} flex items-center justify-center flex-shrink-0 mt-0.5`}
                >
                  {ann.type === "warn" ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : ann.type === "success" ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-[13px] text-slate-800">{ann.title}</div>
                    <svg
                      className={`w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {ann.tag && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.badge}`}>
                        {ann.tag}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">{formatAnnDate(ann.date)}</span>
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pl-14 text-[12px] text-slate-700 leading-relaxed">
                  {ann.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// REPORT LEAK
// ─────────────────────────────────────────────────────────────
export function ResidentReportLeak({ me, useApi }) {
  const [formState, setFormState] = useState({
    location: "",
    description: "",
    severity: "minor",
    contactBack: true,
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState(
    `LK-${Date.now().toString().slice(-6)}`
  );

  async function handleSubmit() {
    if (!formState.location || !formState.description) return;
    setError("");

    if (!useApi) {
      setSubmitted(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitLeakReport({
        location: formState.location,
        description: formState.description,
        severity: formState.severity,
        contactBack: formState.contactBack,
      });
      setTicketId(result.id || ticketId);
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "Could not submit your report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <>
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-800">Report Leak</h1>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center max-w-md">
          <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">
            ✓
          </div>
          <div className="font-bold text-emerald-800 text-[15px] mb-1">Report Submitted!</div>
          <div className="text-[12px] text-emerald-700 mb-3">
            Your leak report has been sent to the barangay water office. A staff member will
            follow up with you shortly.
          </div>
          <div className="bg-white rounded-lg border border-emerald-200 px-4 py-2 inline-block">
            <div className="text-[10px] text-slate-500">Reference Number</div>
            <div className="font-bold text-slate-800">{ticketId}</div>
          </div>
          <div className="mt-4">
            <button
              onClick={() => {
                setSubmitted(false);
                setFormState({ location: "", description: "", severity: "minor", contactBack: true });
              }}
              className="text-[12px] text-emerald-700 hover:underline"
            >
              Submit another report
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">Report Leak</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Report a water leak or pipe issue in your area
        </p>
      </div>

      {/* Usage status — same signal as Usage History, so this page never
          contradicts what the resident sees there. */}
      {(() => {
        const status = getConsumptionStatus(me);
        const styles = {
          good: { wrap: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", label: "text-emerald-800", text: "text-emerald-700" },
          warn: { wrap: "bg-amber-50 border-amber-200", dot: "bg-amber-500", label: "text-amber-800", text: "text-amber-700" },
          bad: { wrap: "bg-rose-50 border-rose-200", dot: "bg-rose-500 animate-pulse", label: "text-rose-800", text: "text-rose-700" },
        }[status.tone];
        return (
          <div className={`rounded-lg border px-4 py-3 mb-4 flex items-center gap-3 ${styles.wrap}`}>
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${styles.dot}`} />
            <div className="text-[12px]">
              <span className={`font-semibold ${styles.label}`}>{status.label}: </span>
              <span className={styles.text}>{status.message}</span>
            </div>
          </div>
        );
      })()}

      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden max-w-lg">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[13px] font-semibold text-slate-700">Leak Report Form</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Household: {me.id} · {me.name}
          </div>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-slate-600 block mb-1">
              Leak Location <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Near standpost, front yard pipe, kitchen faucet…"
              value={formState.location}
              onChange={(e) =>
                setFormState((p) => ({ ...p, location: e.target.value }))
              }
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-[12px] focus:outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-600 block mb-1">
              Severity
            </label>
            <div className="flex gap-2">
              {[
                { value: "minor", label: "Minor drip", color: "emerald" },
                { value: "moderate", label: "Moderate", color: "amber" },
                { value: "major", label: "Major burst", color: "rose" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFormState((p) => ({ ...p, severity: opt.value }))}
                  className={`flex-1 py-2 rounded-lg text-[12px] font-medium border transition ${
                    formState.severity === opt.value
                      ? opt.color === "emerald"
                        ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                        : opt.color === "amber"
                        ? "bg-amber-50 border-amber-400 text-amber-700"
                        : "bg-rose-50 border-rose-400 text-rose-700"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-600 block mb-1">
              Description <span className="text-rose-500">*</span>
            </label>
            <textarea
              placeholder="Describe the issue in detail — when did you notice it, how much water is leaking, etc."
              value={formState.description}
              onChange={(e) =>
                setFormState((p) => ({ ...p, description: e.target.value }))
              }
              rows={3}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-[12px] focus:outline-none focus:border-sky-400 resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="contactBack"
              checked={formState.contactBack}
              onChange={(e) =>
                setFormState((p) => ({ ...p, contactBack: e.target.checked }))
              }
              className="w-4 h-4 rounded border-slate-300"
            />
            <label htmlFor="contactBack" className="text-[12px] text-slate-600">
              Contact me when the issue is resolved
            </label>
          </div>

          {error && (
            <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!formState.location || !formState.description || submitting}
            className={`w-full font-semibold text-[13px] py-2.5 rounded-lg transition ${
              formState.location && formState.description && !submitting
                ? "bg-[#1e3a5f] text-white hover:bg-[#16304f]"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {submitting ? "Submitting…" : "Submit Leak Report"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// HELP & SUPPORT
// ─────────────────────────────────────────────────────────────
const FAQ = [
  {
    q: "How is my bill computed?",
    a: "Current consumed CM² = Total cumulative meter reading − Previous consumed CM². The result is multiplied by ₱20.00 per CM², subject to a minimum billing of ₱200.00 per month.",
  },
  {
    q: "How do I pay my bill online?",
    a: "Go to Payment History and click the 'Pay Now' button or 'Pay with GCash' button. You will be prompted to confirm the amount. Once confirmed, your payment is recorded automatically.",
  },
  {
    q: "What happens if I get a high-usage alert?",
    a: "A high-usage alert means your consumption this cycle is significantly above your average. Check your household pipes and faucets for visible leaks. If you cannot find the source, use the Report Leak page to notify the barangay office.",
  },
  {
    q: "When is the billing period?",
    a: "Bills are generated monthly. Your current billing period is the Month of May 2026. The due date is reflected on your billing statement under My Bills.",
  },
  {
    q: "How do I update my contact information?",
    a: "Go to My Profile and click the Edit button. Update your name, address, phone number, or email address, then click Save Changes.",
  },
  {
    q: "What is the minimum monthly charge?",
    a: "As per barangay policy, the minimum billing is ₱200.00 per month regardless of actual consumption.",
  },
  {
    q: "How do IoT sensors work?",
    a: "Your household meter is equipped with an Arduino-based flow sensor that continuously tracks water usage. Readings are transmitted in real time to the system. Anomalies such as unusually high flow rates trigger automatic alerts visible on your Dashboard.",
  },
];

export function HelpPage() {
  const [openIdx, setOpenIdx] = useState(null);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">Help & Support</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Frequently asked questions and contact information
        </p>
      </div>

      {/* Contact card */}
      <div className="bg-[#1e3a5f] text-white rounded-lg px-5 py-4 mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-bold text-[13px] mb-0.5">Need direct help?</div>
          <div className="text-blue-200 text-[11px]">Contact the Barangay Kinamlutan Water Office</div>
        </div>
        <div className="flex flex-col gap-1 text-right text-[12px]">
          <a href="tel:09639604962" className="text-sky-300 hover:text-white font-medium">
            📞 (963) 960-4962
          </a>
          <a
            href="mailto:barangaykinamlutan@gmail.com"
            className="text-sky-300 hover:text-white font-medium"
          >
            ✉ barangaykinamlutan@gmail.com
          </a>
          <div className="text-blue-300 text-[11px]">Mon–Fri, 8:00 AM – 5:00 PM</div>
        </div>
      </div>

      {/* FAQ accordion */}
      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
        <div className="px-4 py-3 text-[13px] font-semibold text-slate-700 bg-slate-50">
          Frequently Asked Questions
        </div>
        {FAQ.map((item, i) => (
          <div key={i}>
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 transition"
            >
              <span className="text-[13px] font-medium text-slate-700">{item.q}</span>
              <svg
                className={`w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${
                  openIdx === i ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {openIdx === i && (
              <div className="px-4 pb-3 text-[12px] text-slate-500 leading-relaxed bg-slate-50">
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}