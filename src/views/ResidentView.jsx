import React, { useState } from "react";
import { getConsumptionStatus } from "../data";
import {
  LoginScreen,
  ResidentDashboard,
  ResidentConsumption,
  ResidentBills,
  ResidentPayments,
  ResidentProfile,
  ResidentAnnouncements,
  ResidentReportLeak,
  HelpPage,
} from "./ResidentPages";
import logoImage from "../assets/brgy.jpg";

const NAV = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "bills",
    label: "My Bills",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    id: "payments",
    label: "Payment History",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    id: "profile",
    label: "My Profile",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  },
  {
    id: "consumption",
    label: "Usage History",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    id: "announcements",
    label: "Announcements",
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
  {
    id: "leak",
    label: "Report Leak",
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  },
  {
    id: "help",
    label: "Help & Support",
    icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
];

export function ResidentView({
  households,
  activeId,
  setActiveId,
  page,
  setPage,
  myAlerts,
  residentAuthenticated,
  onResidentLogin,
  onResidentGoogleLogin,
  onResidentLogout,
  residentLoginHouseholdId,
  onResidentLoginHouseholdSelect,
  startGcashPayment,
  syncPendingPayment,
  onUpdateProfile,
  useApi,
}) {
  const me = households.find((h) => h.id === activeId) || households[0];
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!residentAuthenticated || page === "login") {
    return (
      <LoginScreen
        households={households}
        onResidentLogin={onResidentLogin}
        onResidentGoogleLogin={onResidentGoogleLogin}
        residentLoginHouseholdId={residentLoginHouseholdId}
        onResidentLoginHouseholdSelect={onResidentLoginHouseholdSelect}
        useApi={useApi}
      />
    );
  }

  const status = getConsumptionStatus(me);
  const currentLabel = NAV.find((i) => i.id === page)?.label || "Dashboard";

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

      {/* ── Sidebar — static on large screens, slide-in drawer on mobile ── */}
      <div className={`
        w-64 lg:w-52 bg-[#1e3a5f] text-white flex flex-col flex-shrink-0
        fixed lg:static inset-y-0 left-0 z-50 lg:z-auto lg:min-h-screen
        transform transition-transform duration-200
        ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
      `}>
        {/* Logo block */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
          <img
            src={logoImage}
            alt="logo"
            className="w-10 h-10 rounded-full object-cover flex-shrink-0 shadow"
          />
          <div className="leading-[1.25] flex-1 min-w-0">
            <div className="font-extrabold text-[10px] uppercase tracking-wide">Barangay</div>
            <div className="font-extrabold text-[10px] uppercase tracking-wide">Kinamlutan</div>
            <div className="font-extrabold text-[10px] uppercase tracking-wide">Water System</div>
          </div>
          {/* Mobile-only close button for the drawer */}
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="lg:hidden w-7 h-7 flex items-center justify-center rounded-md text-blue-200 hover:text-white hover:bg-white/10 transition flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* User card */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10">
          <div className="w-8 h-8 rounded-full bg-slate-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-white truncate">{me.name}</div>
            <div className="text-[10px] text-blue-300">Resident</div>
          </div>
          <svg className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-1.5">
          {NAV.map((item) => {
            const isActive = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goToPage(item.id)}
                className={`w-full text-left px-4 py-2.5 text-[12px] flex items-center gap-2.5 transition border-l-2 ${
                  isActive
                    ? "bg-white/15 font-semibold border-sky-400 text-white"
                    : "text-blue-100 hover:bg-white/5 border-transparent"
                }`}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={item.icon} />
                </svg>
                <span className="truncate">{item.label}</span>
                {item.id === "bills" && me.paymentStatus === "Unpaid" && (
                  <span className="ml-auto bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    1
                  </span>
                )}
                {item.id === "dashboard" && status.level !== "normal" && (
                  <span
                    className={`ml-auto w-2 h-2 rounded-full flex-shrink-0 ${
                      status.level === "high" ? "bg-rose-400" : "bg-amber-400"
                    }`}
                  />
                )}
                {item.id === "leak" && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <button
          onClick={() => {
            if (typeof onResidentLogout === "function") onResidentLogout();
          }}
          className="flex items-center gap-2 px-4 py-3 text-[12px] text-rose-300 hover:text-white border-t border-white/10 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Logout
        </button>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 bg-slate-50 flex flex-col min-w-0">
        <div className="p-4 sm:p-6 flex-1 lg:overflow-y-auto lg:max-h-screen">
          {page === "dashboard"     && <ResidentDashboard me={me} setPage={setPage} alerts={myAlerts} />}
          {page === "bills"         && <ResidentBills me={me} setPage={setPage} startGcashPayment={startGcashPayment} />}
          {page === "payments"      && <ResidentPayments me={me} startGcashPayment={startGcashPayment} syncPendingPayment={syncPendingPayment} />}
          {page === "profile"       && <ResidentProfile me={me} onUpdateProfile={onUpdateProfile} />}
          {page === "consumption"   && <ResidentConsumption me={me} />}
          {page === "announcements" && <ResidentAnnouncements />}
          {page === "leak"          && <ResidentReportLeak me={me} useApi={useApi} />}
          {page === "help"          && <HelpPage />}
        </div>
      </div>
    </div>
  );
}