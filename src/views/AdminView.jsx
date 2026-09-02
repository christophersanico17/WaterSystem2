import React, { useState } from "react";
import { Badge, Btn } from "../ui/atoms";
import {
  DashboardPage,
  ConsumptionPage,
  BillingPage,
  AlertsPage,
  LeakReportsPage,
  HouseholdsPage,
  RecordsPage,
  SettingsPage,
  BillStatementsPage,
  AnnouncementsPage,
  AuditLogPage,
} from "./AdminPages";
import { adminForgotPassword, adminResetPassword } from "../api";
import logoImage from "../assets/brgy.jpg";

const NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  },
  {
    id: "consumption",
    label: "Consumption",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    id: "billing",
    label: "Billing",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    id: "statements",
    label: "Bill Statements",
    icon: "M9 17v-2a4 4 0 014-4h4m0 0l-3-3m3 3l-3 3M4 7h16M4 11h7m-7 4h7m-7 4h7",
  },
  {
    id: "alerts",
    label: "Alerts",
    officerOnly: true,
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  },
  {
    id: "leakreports",
    label: "Leak Reports",
    officerOnly: true,
    icon: "M12 3.75c-3.5 4-6 7.5-6 10.5a6 6 0 0012 0c0-3-2.5-6.5-6-10.5z",
  },
  {
    id: "households",
    label: "Households",
    officerOnly: true,
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "records",
    label: "Records",
    officerOnly: true,
    icon: "M5 8h14M5 8a2 2 0 01-2-2V4a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
  },
  {
    id: "announcements",
    label: "Announcements",
    officerOnly: true,
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
  {
    id: "audit",
    label: "Audit Log",
    officerOnly: true,
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  },
  {
    id: "settings",
    label: "Settings",
    officerOnly: true,
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
  },
];

export function AdminView(props) {
  const {
    households,
    alerts,
    unpaidCount,
    billsGenerated,
    page,
    setPage,
    adminAuthenticated,
    onAdminLogin,
    onAdminLogout,
    adminEmail,
    adminRole = "officer",
    markPaid,
    markUnpaid,
    receiveGcashPayment,
    showToast,
    alertFilter,
    setAlertFilter,
    selectedAlertId,
    setSelectedAlertId,
    resolveAlert,
    unresolveAlert,
    leakReports = [],
    resolveLeakReport,
    reopenLeakReport,
    onResetResidentPassword,
    onGenerateBills,
    onAddHousehold,
  } = props;

  const isOfficer = adminRole === "officer";
  const roleLabel = isOfficer ? "Water Officer" : "Collector";
  // Collectors get a payments-focused subset of the navigation.
  const navItems = NAV_ITEMS.filter((item) => isOfficer || !item.officerOnly);

  const unresolvedCount = alerts.filter((a) => a.status === "Unresolved").length;
  const openLeakReportCount = leakReports.filter((r) => r.status === "Open").length;
  const gcashPendingCount = households.filter((h) => h.paymentStatus === "GCash Pending").length;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!adminAuthenticated || page === "login") {
    return <AdminLoginScreen onAdminLogin={onAdminLogin} />;
  }

  // A collector who somehow lands on an officer-only page falls back to the dashboard.
  const activePage = navItems.some((i) => i.id === page) ? page : "dashboard";
  const currentLabel = NAV_ITEMS.find((i) => i.id === activePage)?.label || "Dashboard";

  // On mobile, selecting a page should also close the slide-in drawer.
  const goToPage = (id) => {
    setPage(id);
    setMobileNavOpen(false);
  };

  return (
    <div className="lg:flex min-h-screen">
      {/* Mobile top bar (hidden on large screens) */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 bg-[#1e3a5f] text-white px-4 py-3">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-white/10 transition"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <img src={logoImage} alt="logo" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
        <div className="font-semibold text-[13px] truncate">{currentLabel}</div>
      </div>

      {/* Backdrop when the mobile drawer is open */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar — static on large screens, slide-in drawer on mobile */}
      <div className={`
        ${collapsed ? "lg:w-16" : "lg:w-52"} w-64
        bg-[#1e3a5f] text-white flex flex-col flex-shrink-0
        fixed lg:static inset-y-0 left-0 z-50 lg:z-auto lg:min-h-screen
        transform transition-transform duration-200
        ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
      `}>
        {/* Logo block + collapse toggle */}
        <div className={`flex items-center px-3 py-4 border-b border-white/10 gap-2.5 ${collapsed ? "lg:flex-col lg:gap-3" : ""}`}>
          <img
            src={logoImage}
            alt="logo"
            className="w-10 h-10 rounded-full object-cover flex-shrink-0 shadow"
          />
          <div className={`leading-[1.25] flex-1 min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
            <div className="font-extrabold text-[10px] uppercase tracking-wide">Barangay</div>
            <div className="font-extrabold text-[10px] uppercase tracking-wide">Kinamlutan</div>
            <div className="font-extrabold text-[10px] uppercase tracking-wide">Water System</div>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:flex w-7 h-7 items-center justify-center rounded-md text-blue-200 hover:text-white hover:bg-white/10 transition flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
            </svg>
          </button>
          {/* Mobile-only close button for the drawer */}
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="lg:hidden ml-auto w-7 h-7 flex items-center justify-center rounded-md text-blue-200 hover:text-white hover:bg-white/10 transition flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Admin info */}
        <div className={`flex items-center px-3 py-3 border-b border-white/10 gap-2.5 ${collapsed ? "lg:gap-0 lg:justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0" title={collapsed ? adminEmail || "Admin" : undefined}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className={`flex-1 min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
            <div className="text-[12px] font-semibold text-white truncate">{adminEmail || "Admin"}</div>
            <div className="text-[10px] text-blue-300">{roleLabel}</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-1.5">
          {navItems.map((item) => {
            const isActive = activePage === item.id;
            const badgeCount =
              item.id === "alerts" ? unresolvedCount
              : item.id === "leakreports" ? openLeakReportCount
              : item.id === "billing" ? gcashPendingCount
              : 0;
            const badgeColor = item.id === "alerts" || item.id === "leakreports" ? "text-rose-400" : "text-sky-300";
            return (
              <button
                key={item.id}
                onClick={() => goToPage(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full text-[12px] flex items-center transition border-l-2 text-left px-4 py-2.5 gap-2.5 ${
                  collapsed ? "lg:justify-center lg:px-0 lg:gap-0" : ""
                } ${
                  isActive
                    ? "bg-white/15 font-semibold border-sky-400 text-white"
                    : "text-blue-100 hover:bg-white/5 border-transparent"
                }`}
              >
                <span className="relative flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={item.icon} />
                  </svg>
                  {/* Collapsed (desktop only): show the count as a small number on the icon corner */}
                  {collapsed && badgeCount > 0 && (
                    <span className={`hidden lg:block absolute -top-1.5 -right-2.5 ${badgeColor} text-[10px] font-bold tabular-nums leading-none`}>
                      {badgeCount}
                    </span>
                  )}
                </span>
                <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                {badgeCount > 0 && (
                  <span className={`ml-auto ${badgeColor} text-[12px] font-semibold tabular-nums leading-none ${collapsed ? "lg:hidden" : ""}`}>
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <button
          onClick={() => {
            if (typeof onAdminLogout === "function") onAdminLogout();
          }}
          title={collapsed ? "Logout" : undefined}
          className={`flex items-center py-3 text-[12px] text-rose-300 hover:text-white border-t border-white/10 transition gap-2 px-4 ${
            collapsed ? "lg:justify-center lg:px-0 lg:gap-0" : ""
          }`}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          <span className={collapsed ? "lg:hidden" : ""}>Logout</span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 bg-slate-50 min-w-0">
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-2 flex items-center justify-between gap-2">
          <div className="text-[12px] text-slate-500 truncate">
            Signed in as <span className="font-semibold text-slate-700">{adminEmail || "Admin"}</span>
          </div>
          <div className="hidden sm:block text-[11px] text-slate-400 flex-shrink-0">
            {new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
        </div>
        <div className="p-4 sm:p-6 lg:max-h-[calc(100vh-41px)] lg:overflow-y-auto">
          {activePage === "dashboard" && (
            <DashboardPage
              households={households}
              alerts={alerts}
              unpaidCount={unpaidCount}
              setPage={setPage}
            />
          )}
          {activePage === "consumption" && <ConsumptionPage households={households} />}
          {activePage === "billing" && (
            <BillingPage
              households={households}
              markPaid={markPaid}
              markUnpaid={markUnpaid}
              receiveGcashPayment={receiveGcashPayment}
              showToast={showToast}
              billsGenerated={billsGenerated}
              unpaidCount={unpaidCount}
              onGenerateBills={onGenerateBills}
              canGenerateBills={isOfficer}
            />
          )}
          {activePage === "alerts" && (
            <AlertsPage
              alerts={alerts}
              filter={alertFilter}
              setFilter={setAlertFilter}
              selectedAlertId={selectedAlertId}
              setSelectedAlertId={setSelectedAlertId}
              resolveAlert={resolveAlert}
              unresolveAlert={unresolveAlert}
            />
          )}
          {activePage === "leakreports" && (
            <LeakReportsPage
              leakReports={leakReports}
              resolveLeakReport={resolveLeakReport}
              reopenLeakReport={reopenLeakReport}
            />
          )}
          {activePage === "households" && (
            <HouseholdsPage
              households={households}
              showToast={showToast}
              onResetPassword={onResetResidentPassword}
              onAddHousehold={onAddHousehold}
            />
          )}
          {activePage === "records" && <RecordsPage households={households} showToast={showToast} />}
          {activePage === "statements" && <BillStatementsPage households={households} />}
          {activePage === "announcements" && <AnnouncementsPage showToast={showToast} />}
          {activePage === "audit" && <AuditLogPage showToast={showToast} />}
          {activePage === "settings" && <SettingsPage showToast={showToast} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ADMIN LOGIN — matches handleAdminLogin({ email, password })
//   -> returns/resolves { success, message? }
// Valid demo creds: admin@barangay.local / wateroffice@barangay.local
// with any password 8+ characters.
// ─────────────────────────────────────────────────────────────
function AdminLoginScreen({ onAdminLogin }) {
  const [mode, setMode] = useState("login"); // 'login' | 'forgot'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await onAdminLogin({ email, password });
      if (!result || !result.success) {
        setError((result && result.message) || "Login failed. Please try again.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "forgot") {
    return (
      <ForgotPasswordScreen
        initialEmail={email}
        onDone={(resetEmail, message) => {
          setEmail(resetEmail);
          setPassword("");
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
              Admin Sign In
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mb-5 text-center">
              Enter your admin credentials to access the water system dashboard.
            </div>

            {info && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 mb-4 text-xs sm:text-[13px] text-emerald-700">
                {info}
              </div>
            )}

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2">
                <svg className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-xs sm:text-[13px] text-rose-700">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Email */}
              <div className="mb-3">
                <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                    placeholder="admin@barangay.local"
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="mb-1">
                <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    className="w-full border border-slate-300 rounded-lg pl-9 pr-10 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div className="text-right mb-5">
                <button
                  type="button"
                  onClick={() => { setError(""); setInfo(""); setMode("forgot"); }}
                  className="text-xs sm:text-[13px] text-sky-600 hover:text-sky-800 font-medium"
                >
                  Forgot password?
                </button>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className={`w-full text-white text-sm sm:text-base font-semibold py-2.5 sm:py-3 rounded-lg transition active:scale-[0.98] ${
                  submitting ? "bg-slate-400 cursor-not-allowed" : "bg-[#1e3a5f] hover:bg-[#16304f]"
                }`}
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-4 text-xs sm:text-[13px] text-slate-400">
          Barangay Kinamlutan, Butuan City · ZIP 8600
        </div>
        <div className="text-center mt-2 text-xs sm:text-[13px] text-slate-500">
          Resident?{" "}
          <a href="/resident" className="text-sky-600 hover:text-sky-800 font-medium">
            Go to the resident portal
          </a>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FORGOT PASSWORD — two steps on one screen:
//   1) request a reset code for an email
//   2) enter the code + a new password
// No email service is configured, so the code is shown directly on screen
// instead of being emailed (the code still expires and is rate-limited
// server-side, same as a real flow).
// ─────────────────────────────────────────────────────────────
function ForgotPasswordScreen({ initialEmail, onDone, onCancel }) {
  const [email, setEmail] = useState(initialEmail || "");
  const [resetCode, setResetCode] = useState(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleRequestCode(e) {
    e.preventDefault();
    setError("");
    if (!email) {
      setError("Email is required.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await adminForgotPassword(email);
      if (!result.success) {
        setError(result.message || "Could not send a reset code.");
        return;
      }
      setResetCode(result.resetCode);
      setCodeInput(result.resetCode);
      setExpiresInMinutes(result.expiresInMinutes);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError("");
    if (!codeInput || !newPassword) {
      setError("Reset code and new password are required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await adminResetPassword({ email, code: codeInput, newPassword });
      if (!result.success) {
        setError(result.message || "Could not reset your password.");
        return;
      }
      onDone(email, "Password reset successfully. Sign in with your new password.");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
              Reset Password
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mb-5 text-center">
              {resetCode
                ? "Enter the reset code and choose a new password."
                : "Enter your admin email to get a reset code."}
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 mb-4 text-xs sm:text-[13px] text-rose-700">
                {error}
              </div>
            )}

            {!resetCode ? (
              <form onSubmit={handleRequestCode}>
                <div className="mb-5">
                  <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                      placeholder="admin@barangay.local"
                      autoComplete="username"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full text-white text-sm sm:text-base font-semibold py-2.5 sm:py-3 rounded-lg transition active:scale-[0.98] ${
                    submitting ? "bg-slate-400 cursor-not-allowed" : "bg-[#1e3a5f] hover:bg-[#16304f]"
                  }`}
                >
                  {submitting ? "Sending…" : "Send Reset Code"}
                </button>
              </form>
            ) : (
              <>
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2.5 mb-4 text-xs sm:text-[13px] text-sky-800">
                  <div className="font-semibold mb-1">
                    No email service is configured, so here's your reset code:
                  </div>
                  <div className="text-2xl font-mono font-bold tracking-widest text-center py-1 text-slate-800">
                    {resetCode}
                  </div>
                  <div className="text-xs sm:text-[13px] text-sky-600 text-center">
                    Valid for {expiresInMinutes} minutes.
                  </div>
                </div>

                <form onSubmit={handleResetPassword}>
                  <div className="mb-3">
                    <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                      Reset Code
                    </label>
                    <input
                      type="text"
                      value={codeInput}
                      onChange={(e) => { setCodeInput(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-3 text-base font-mono tracking-widest focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition placeholder-slate-300"
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="mb-5">
                    <label className="text-xs sm:text-[13px] font-semibold text-slate-600 block mb-1.5">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-3 text-base focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition"
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`w-full text-white text-sm sm:text-base font-semibold py-2.5 sm:py-3 rounded-lg transition active:scale-[0.98] ${
                      submitting ? "bg-slate-400 cursor-not-allowed" : "bg-[#1e3a5f] hover:bg-[#16304f]"
                    }`}
                  >
                    {submitting ? "Resetting…" : "Reset Password"}
                  </button>
                </form>
              </>
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

        {/* Footer */}
        <div className="text-center mt-4 text-xs sm:text-[13px] text-slate-400">
          Barangay Kinamlutan, Butuan City · ZIP 8600
        </div>
      </div>
    </div>
  );
}