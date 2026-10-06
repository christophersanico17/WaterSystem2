import React, { useState, useEffect } from "react";
import { Badge, StatCard, Btn } from "../ui/atoms";
import { SectionHeader } from "../components/SectionHeader";
import { BillReplica } from "../components/BillReplica";
import { deviceStatus, isDeviceOnline, DEVICE_STATUS_TICK_MS } from "../deviceStatus";
import { BILLING_PERIOD, RATE_PER_CM3, MIN_BILL, dateStamp, peso, isOverdue, daysOverdue } from "../data";
import {
  fetchAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  fetchAuditLog,
  fetchAlertSettings,
  updateAlertSettingsApi,
  fetchDeviceStatus,
  fetchAdminAccounts,
  createAdminAccount,
  deleteAdminAccount,
} from "../api";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const PUROK_GROUPS = ["Purok 1", "Purok 2", "Purok 2A", "Purok 3", "Purok 4", "Purok 5", "Purok 6", "Purok 7"];

function householdPurok(household) {
  const address = String(household.purok || household.address || "");
  const match = address.match(/\bpurok[\s-]*(2a|[1-7])\b/i);
  if (match) return `Purok ${match[1].toUpperCase()}`;

  const inferredPurok = Number(household.standpost) % 9 || 5;
  const inferredGroup = `Purok ${inferredPurok}`;
  return PUROK_GROUPS.includes(inferredGroup) ? inferredGroup : "Other";
}
export function DashboardPage({ households, alerts, unpaidCount, setPage }) {
  const recentAlerts = alerts.slice(0, 5);
  const goto = (p) => { if (typeof setPage === "function") setPage(p); };

  // The date the dashboard is "viewing". Defaults to the configured billing
  // period (e.g. "May 2026") so the chart lines up with the billing summary.
  const [bpMonth, bpYear] = ["May", "2026"];
  const today = new Date();
  const [month, setMonth] = useState(Math.max(0, MONTHS.indexOf(bpMonth))); // 0–11
  const [year, setYear] = useState(Number(bpYear) || today.getFullYear());
  const [day, setDay] = useState(today.getDate());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(day, daysInMonth);
  const periodLabel = `${MONTHS[month]} ${year}`;
  const currentPeriodLabel = `${MONTHS[today.getMonth()]} ${today.getFullYear()}`;
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const displayDate = new Date(year, month, safeDay).toLocaleDateString("en-PH", {
    year: "numeric", month: "long", day: "numeric",
  });

  // Years offered in the picker: every year present in billing history plus a
  // couple around today, so the admin can move between real periods.
  const historyYears = households.flatMap((h) =>
    (h.history || []).map((r) => Number((r.period || "").split(" ")[1]))
  ).filter(Boolean);
  const yearOptions = [...new Set([
    ...historyYears, today.getFullYear(), today.getFullYear() + 1, year,
  ])].sort((a, b) => a - b);

  // Consumption for the selected period, pulled from each household's billing
  // history. For the current month, prefer a fresh meter reading over the
  // bill snapshot so consumption keeps updating through the month.
  const withUsage = households.map((h) => {
    const rec = (h.history || []).find((r) => r.period === periodLabel);
    const previousPeriodRecord = (h.history || []).filter((r) => r.period !== currentPeriodLabel).at(-1);
    const currentPeriodBaseline = rec?.prev ?? previousPeriodRecord?.curr;
    const hasCurrentMonthReading =
      periodLabel === currentPeriodLabel &&
      String(h.lastReadingAt || "").slice(0, 7) === currentMonthKey &&
      Number.isFinite(Number(h.currCm3)) &&
      Number.isFinite(Number(currentPeriodBaseline));
    const hasRealData = Boolean(rec || hasCurrentMonthReading);
    const periodUsage = hasCurrentMonthReading
      ? Math.max(0, Number(h.currCm3) - Number(currentPeriodBaseline))
      : rec
      ? Math.max(0, rec.curr - rec.prev)
      : 0;
    return {
      ...h,
      rec,
      periodUsage,
      hasData: hasRealData,
      hasBillData: Boolean(rec),
      // Only the latest billing period carries a live paid/unpaid status; older
      // periods are treated as settled (same convention as the resident view).
      isLatestPeriod: periodLabel === h.period,
    };
  });
  const top10 = [...withUsage].sort((a, b) => b.periodUsage - a.periodUsage).slice(0, 10);
  const maxUsage = Math.max(...top10.map((h) => h.periodUsage), 1);
  const anyData = withUsage.some((h) => h.hasData);
  const billingRows = withUsage.filter((h) => h.hasBillData).slice(0, 6);

  const selectCls =
    "border border-slate-300 rounded-lg px-2.5 py-1.5 text-[12px] bg-white text-slate-700 focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f]";

  return (
    <>
      <SectionHeader title="Admin Dashboard" sub={`Barangay Kinamlutan Water System — ${displayDate}`} />

      {/* Period picker — choose month, day, and year; the chart + header follow it */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-[12px] font-medium text-slate-500">Viewing period:</span>
        <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))} className={selectCls}>
          {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <select aria-label="Day" value={safeDay} onChange={(e) => setDay(Number(e.target.value))} className={selectCls}>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { setMonth(today.getMonth()); setDay(today.getDate()); setYear(today.getFullYear()); }}
          className="text-[12px] text-sky-600 hover:text-sky-800 font-medium px-1"
        >
          Today
        </button>
      </div>
      <div className="flex gap-3 flex-wrap mb-5">
        <button onClick={() => goto("households")} className="flex-1 min-w-[130px] text-left">
          <StatCard label="Total households" value={households.length} />
        </button>
        <button onClick={() => goto("consumption")} className="flex-1 min-w-[130px] text-left">
          <StatCard label="Active connections" value={households.length} tone="good" />
        </button>
        <button onClick={() => goto("alerts")} className="flex-1 min-w-[130px] text-left">
          <StatCard label="Alerts today" value={alerts.filter((a) => a.status === "Unresolved").length} tone="warn" />
        </button>
        <button onClick={() => goto("billing")} className="flex-1 min-w-[130px] text-left">
          <StatCard label="Unpaid bills" value={unpaidCount} tone="bad" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="lg:col-span-2 card-hover bg-white rounded-lg border border-slate-200 p-4">
          <div className="font-semibold text-[13px] text-slate-700 mb-3">Water consumption — Month of {periodLabel} (CM³) · top households</div>
          {anyData ? (
            <div className="flex items-end gap-2 h-32">
              <style>{`
                @keyframes barRise {
                  from { transform: scaleY(0); opacity: 0.35; }
                  to   { transform: scaleY(1); opacity: 1; }
                }
                .bar-rise { transform-origin: bottom; animation: barRise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
                @media (prefers-reduced-motion: reduce) { .bar-rise { animation: none; } }
              `}</style>
              {top10.map((h, i) => {
                const heightPct = Math.min((h.periodUsage / maxUsage) * 100, 100);
                const amber = h.periodUsage > 35;
                return (
                  <div key={`${h.id}-${periodLabel}`} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div className="text-[9px] text-slate-400 mb-1">{h.periodUsage}</div>
                    <div
                      className={`w-full rounded-t-sm bar-rise cursor-default transition-[filter] duration-150 hover:brightness-110 ${amber ? "bg-amber-400" : "bg-sky-700"}`}
                      style={{
                        height: `${heightPct}%`,
                        minHeight: "6px",
                        animationDelay: `${i * 0.06}s`,
                      }}
                    />
                    <div className="text-[9px] text-slate-500 mt-1">{h.id.replace("HH-", "")}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-center gap-1">
              <div className="text-[12px] text-slate-500">No consumption records for {periodLabel}.</div>
              <div className="text-[11px] text-slate-400">Pick a different month or year above.</div>
            </div>
          )}
        </div>

        <div className="card-hover bg-white rounded-lg border border-slate-200 p-4">
          <div className="font-semibold text-[13px] text-slate-700 mb-3">Recent alerts</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left font-medium pb-1.5">Household</th>
                <th className="text-left font-medium pb-1.5">Type</th>
                <th className="text-right font-medium pb-1.5">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentAlerts.map((a) => (
                <tr key={a.id} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-700">{a.householdId}</td>
                  <td className={`py-1.5 ${a.type === "Leak Detected" ? "text-rose-600" : a.type === "High Flow" ? "text-amber-600" : "text-slate-400"}`}>{a.type}</td>
                  <td className="py-1.5 text-right text-slate-400">{a.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-hover bg-white rounded-lg border border-slate-200 p-4">
        <div className="font-semibold text-[13px] text-slate-700 mb-3">Billing summary — Month of {periodLabel}</div>
        {billingRows.length > 0 ? (
        <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[560px]">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              <th className="text-left px-3 py-2 font-semibold">Bill #</th>
              <th className="text-left px-3 py-2 font-semibold">Household</th>
              <th className="text-left px-3 py-2 font-semibold">Resident name</th>
              <th className="text-right px-3 py-2 font-semibold">Standpost #</th>
              <th className="text-right px-3 py-2 font-semibold">Curr CM³</th>
              <th className="text-right px-3 py-2 font-semibold">Consumption</th>
              <th className="text-right px-3 py-2 font-semibold">Total amount</th>
              <th className="text-center px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {billingRows.map((h, i) => {
              const status = h.isLatestPeriod ? h.paymentStatus : "Paid";
              return (
              <tr key={h.id} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                <td className="px-3 py-1.5 text-slate-500">BL-{String(i + 1).padStart(3, "0")}</td>
                <td className="px-3 py-1.5 font-medium text-slate-700">{h.id}</td>
                <td className="px-3 py-1.5 text-slate-600">{h.name}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{h.standpost}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{h.rec.curr}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{h.periodUsage}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{peso(h.rec.amt)}</td>
                <td className="px-3 py-1.5 text-center">
                  {status === "Paid" ? <Badge tone="good">Paid</Badge> : <Badge tone="bad">Unpaid</Badge>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        ) : (
          <div className="py-8 text-center text-[12px] text-slate-400">No bills for {periodLabel}.</div>
        )}
      </div>
    </>
  );
}

export function ConsumptionPage({ households }) {
  // Period selector — mirrors the dashboard's, scoped to month + year since
  // consumption is a monthly figure.
  const [bpMonth, bpYear] = ["May", "2026"];
  const today = new Date();
  const [month, setMonth] = useState(Math.max(0, MONTHS.indexOf(bpMonth)));
  const [year, setYear] = useState(Number(bpYear) || today.getFullYear());
  const periodLabel = `${MONTHS[month]} ${year}`;

  const historyYears = households.flatMap((h) =>
    (h.history || []).map((r) => Number((r.period || "").split(" ")[1]))
  ).filter(Boolean);
  const yearOptions = [...new Set([
    ...historyYears, today.getFullYear(), today.getFullYear() + 1, year,
  ])].sort((a, b) => a - b);

  // Readings for the selected period, from each household's billing history.
  // Live flow/status only apply to the current (latest) period.
  const rows = households
    .map((h) => {
      const rec = (h.history || []).find((r) => r.period === periodLabel);
      return { ...h, rec, isLatest: periodLabel === h.period, hasData: !!rec };
    })
    .filter((h) => h.hasData);

  const selectCls =
    "border border-slate-300 rounded-lg px-2.5 py-1.5 text-[12px] bg-white text-slate-700 focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f]";

  return (
    <>
      <SectionHeader title="Water Consumption" sub={`Meter readings for ${periodLabel} · transmitted from IoT flow sensors`} />

      {/* Period picker — choose month and year; the readings below follow it */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[12px] font-medium text-slate-500">Viewing period:</span>
        <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))} className={selectCls}>
          {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); }}
          className="text-[12px] text-sky-600 hover:text-sky-800 font-medium px-1"
        >
          This month
        </button>
      </div>

      {rows.length > 0 ? (
        <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-[12px] min-w-[620px]">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="text-left px-3 py-2 font-semibold">Household</th>
                <th className="text-left px-3 py-2 font-semibold">Resident</th>
                <th className="text-right px-3 py-2 font-semibold">Prev. CM³</th>
                <th className="text-right px-3 py-2 font-semibold">Curr. CM³</th>
                <th className="text-right px-3 py-2 font-semibold">Consumption</th>
                <th className="text-right px-3 py-2 font-semibold">Flow (L/min)</th>
                <th className="text-center px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h, i) => {
                const consumption = Math.max(0, h.rec.curr - h.rec.prev);
                return (
                  <tr key={h.id} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-3 py-2 font-medium text-slate-700">{h.id}</td>
                    <td className="px-3 py-2 text-slate-600">{h.name}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{h.rec.prev}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{h.rec.curr}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{consumption}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{h.isLatest && h.deviceProvisioned && h.deviceLastSeen ? h.lastFlow : "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {h.isLatest && h.deviceProvisioned && h.deviceLastSeen ? (
                        h.flowType === "High flow" ? <Badge tone="bad">High flow</Badge> : <Badge tone="good">Normal</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-hover bg-white rounded-lg border border-slate-200 py-10 text-center text-[12px] text-slate-400">
          No meter readings for {periodLabel}.
        </div>
      )}
    </>
  );
}

export function BillingPage({ households, markPaid, markUnpaid, receiveGcashPayment, receiveCashPayment, showToast, billsGenerated, unpaidCount, onGenerateBills, canGenerateBills = true }) {
  const paidCount = households.length - unpaidCount;
  const gcashPendingCount = households.filter((h) => h.paymentStatus === "GCash Pending").length;
  const cashPendingCount = households.filter((h) => h.paymentStatus === "Cash Pending").length;
  const overdueCount = households.filter(isOverdue).length;
  const [statusFilter, setStatusFilter] = React.useState("All");
  // { action: "paid" | "unpaid", id, name, amt } while a confirmation is pending.
  const [confirmPay, setConfirmPay] = React.useState(null);
  const [verifyGcash, setVerifyGcash] = React.useState(null);
  const [adminReference, setAdminReference] = React.useState("");
  // Method picked in the "Mark paid" modal — "Offline" (cash) or "GCash"
  // (manually recording a GCash payment received outside the automatic flow).
  const [payMethod, setPayMethod] = React.useState("Offline");

  async function confirmPayment() {
    if (!confirmPay) return;
    const { id, action } = confirmPay;
    setConfirmPay(null);
    if (action === "unpaid") {
      markUnpaid(id);
    } else {
      const marked = await markPaid(id, payMethod);
      if (marked) showToast(`${id} marked as paid (${payMethod === "GCash" ? "GCash" : "Cash"})`, "success");
    }
    setPayMethod("Offline");
  }

  function openManualGcashVerification() {
    if (!confirmPay) return;
    const { id, name, amt } = confirmPay;
    setConfirmPay(null);
    setPayMethod("Offline");
    setAdminReference("");
    setVerifyGcash({ id, name, amount: amt, mode: "manual" });
  }

  async function confirmGcashReference() {
    if (!verifyGcash) return;
    const confirmed = verifyGcash.mode === "manual"
      ? await markPaid(verifyGcash.id, "GCash", undefined, adminReference)
      : await receiveGcashPayment(verifyGcash.id, adminReference);
    if (confirmed) {
      if (verifyGcash.mode === "manual") {
        showToast(`${verifyGcash.id} GCash payment verified and recorded`, "success");
      }
      setVerifyGcash(null);
      setAdminReference("");
    }
  }
  const monthOptions = [
    "All months",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const yearOptions = ["All years", "2024", "2025", "2026", "2027"];
  const monthMap = {
    January: "Jan",
    February: "Feb",
    March: "Mar",
    April: "Apr",
    May: "May",
    June: "Jun",
    July: "Jul",
    August: "Aug",
    September: "Sep",
    October: "Oct",
    November: "Nov",
    December: "Dec",
  };
  const [selectedBillingMonth, setSelectedBillingMonth] = React.useState("May");
  const [selectedBillingYear, setSelectedBillingYear] = React.useState("2026");
  const selectedPeriodLabel =
    selectedBillingMonth === "All months"
      ? selectedBillingYear === "All years"
        ? "All records"
        : selectedBillingYear
      : selectedBillingYear === "All years"
      ? selectedBillingMonth
      : `${selectedBillingMonth} ${selectedBillingYear}`;
  const billingRecords = households.flatMap((h) =>
    h.history
      .filter((rec) => {
        const [recMonth, recYear] = rec.period.split(" ");
        const monthMatches = selectedBillingMonth === "All months" || monthMap[selectedBillingMonth] === recMonth;
        const yearMatches = selectedBillingYear === "All years" || selectedBillingYear === recYear;
        return monthMatches && yearMatches;
      })
      .map((rec) => ({ household: h, record: rec }))
  );
  const selectedPeriodKey =
    selectedBillingMonth === "All months" || selectedBillingYear === "All years"
      ? null
      : `${monthMap[selectedBillingMonth]} ${selectedBillingYear}`;

  const filteredBillingRecords = billingRecords.filter(({ household }) => {
    if (statusFilter === "All") return true;
    if (statusFilter === "GCash Pending") return household.paymentStatus === "GCash Pending";
    if (statusFilter === "Cash Pending") return household.paymentStatus === "Cash Pending";
    if (statusFilter === "Overdue") return isOverdue(household);
    return statusFilter === "Paid" ? household.paymentStatus === "Paid" : household.paymentStatus === "Unpaid";
  });

  return (
    <>
      <SectionHeader title="Billing Management" />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Billing month</label>
            <select
              value={selectedBillingMonth}
              onChange={(e) => setSelectedBillingMonth(e.target.value)}
              className="w-full max-w-[170px] border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm font-semibold"
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Billing year</label>
            <select
              value={selectedBillingYear}
              onChange={(e) => setSelectedBillingYear(e.target.value)}
              className="w-full max-w-[110px] border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm font-semibold"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {canGenerateBills && (
            <Btn
              variant="primary"
              onClick={() => {
                if (!selectedPeriodKey) {
                  showToast("Select a specific billing month and year first.", "warn");
                  return;
                }
                if (typeof onGenerateBills === "function") {
                  onGenerateBills(selectedPeriodKey);
                } else {
                  showToast("Bills generated for all households", "success");
                }
              }}
            >
              Generate Bills
            </Btn>
          )}
          <Btn onClick={() => window.print()}>Export PDF</Btn>
          <Btn onClick={() => {
            const header = ["Bill #","Household","Resident name","Standpost #","Meter #","Prev CM3","Curr CM3","Consumed","Total Amount","Method","Status"];
            const rows = filteredBillingRecords.map(({ household, record }, i) => [
              `BL-${String(i + 1).padStart(3, "0")}`,
              household.id,
              household.name,
              household.standpost,
              household.meter,
              record.prev,
              record.curr,
              record.curr - record.prev,
              record.amt,
              household.paymentStatus === "Paid" ? (household.paymentMethod === "GCash" ? "GCash" : "Cash") : household.paymentStatus === "GCash Pending" ? "GCash" : household.paymentStatus === "Cash Pending" ? "Cash" : "Pending",
              household.paymentStatus,
            ]);
            const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `billing-records-${selectedPeriodLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("Billing records exported as CSV", "success");
          }}>Export CSV</Btn>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap mb-4">
        <StatCard label="Total households" value={households.length} />
        <StatCard label="Bills generated" value={billsGenerated} />
        <StatCard label="Paid" value={paidCount} tone="good" />
        <StatCard label="GCash pending" value={gcashPendingCount} tone="warn" />
        <StatCard label="Cash pending" value={cashPendingCount} tone="warn" />
        <StatCard label="Unpaid" value={unpaidCount} tone="bad" />
        <StatCard label="Overdue" value={overdueCount} tone="bad" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {['All', 'Paid', 'GCash Pending', 'Cash Pending', 'Unpaid', 'Overdue'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition ${
              statusFilter === status
                ? status === 'Paid'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : status === 'Unpaid'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : status === 'Overdue'
                  ? 'bg-red-700 text-white border-red-700'
                  : status === 'GCash Pending'
                  ? 'bg-sky-600 text-white border-sky-600'
                  : status === 'Cash Pending'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {status}{status === 'Overdue' && overdueCount > 0 ? ` (${overdueCount})` : ''}
          </button>
        ))}
      </div>

      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden mb-3 print-area">
        <div className="px-4 py-2.5 text-[13px] font-semibold text-slate-700 border-b border-slate-100">Billing records — {selectedPeriodLabel}</div>
        <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Bill #</th>
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Household</th>
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Resident name</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Standpost #</th>
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Meter #</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Prev CM³</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Curr CM³</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Consumed</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Total Amt</th>
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Method</th>
              <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">GCash reference</th>
              <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">Status</th>
              <th className="text-center px-3 py-2 font-semibold whitespace-nowrap no-print">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredBillingRecords.length > 0 ? (
              filteredBillingRecords.map(({ household, record }, i) => (
                <tr key={`${household.id}-${record.period}`} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">BL-{String(i + 1).padStart(3, "0")}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">{household.id}</td>
                  <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{household.name}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{household.standpost}</td>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{household.meter}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{record.prev}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{record.curr}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{record.curr - record.prev}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-800 whitespace-nowrap">{peso(record.amt)}</td>
                  <td className="px-3 py-1.5 text-left text-slate-700 whitespace-nowrap">
                    {household.paymentStatus === "Paid"
                      ? household.paymentMethod === "GCash" ? "GCash" : "Cash"
                      : household.paymentStatus === "GCash Pending"
                      ? "GCash"
                      : household.paymentStatus === "Cash Pending"
                      ? "Cash"
                      : "Pending"}
                  </td>
                  <td className="px-3 py-1.5 text-left text-slate-700 whitespace-nowrap font-mono">
                    {household.paymentStatus === "Paid" &&
                    household.paymentMethod === "GCash" &&
                    record.period === household.period
                      ? household.paymentReference || "—"
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                    {household.paymentStatus === "Paid" ? (
                      <Badge tone="good">Paid</Badge>
                    ) : isOverdue(household) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-700 text-white">
                        Overdue · {daysOverdue(household.dueDate, household.paymentStatus)}d
                      </span>
                    ) : household.paymentStatus === "GCash Pending" ? (
                      <Badge tone="info">GCash Pending</Badge>
                    ) : household.paymentStatus === "Cash Pending" ? (
                      <Badge tone="warn">Cash Pending</Badge>
                    ) : (
                      <Badge tone="bad">Unpaid</Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap no-print">
                    {household.paymentStatus === "GCash Pending" ? (
                      <Btn
                        variant="primary"
                        onClick={() => {
                          if (!household.paymentReference) {
                            receiveGcashPayment(household.id);
                            return;
                          }
                          setAdminReference("");
                          setVerifyGcash({
                            id: household.id,
                            name: household.name,
                            amount: household.totalDue,
                            residentReference: household.paymentReference,
                            mode: "automatic",
                          });
                        }}
                      >
                        {household.paymentReference ? "Verify GCash reference" : "Confirm GCash"}
                      </Btn>
                    ) : household.paymentStatus === "Cash Pending" ? (
                      <Btn
                        variant="primary"
                        onClick={() => {
                          receiveCashPayment(household.id);
                        }}
                      >
                        Confirm Cash
                      </Btn>
                    ) : household.paymentStatus === "Paid" ? (
                      <Btn variant="ghostMuted" onClick={() => setConfirmPay({ action: "unpaid", id: household.id, name: household.name, amt: record.amt })}>
                        Mark unpaid
                      </Btn>
                    ) : selectedPeriodKey && record.period === selectedPeriodKey && household.paymentStatus === "Unpaid" ? (
                      <Btn variant="ghost" onClick={() => setConfirmPay({ action: "paid", id: household.id, name: household.name, amt: record.amt })}>
                        Mark paid
                      </Btn>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-slate-500">No records found for {selectedBillingMonth} {selectedBillingYear}.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-[11px] text-slate-500">
        <div className="font-semibold text-slate-600 mb-0.5">Billing formula & rate reference</div>
        CC CM² = TCCM² − PC CM²  |  Rate: ₱20.00 per CM²  |  Minimum billing: ₱200.00  |  1 CM² = 1,000 liters
        <br />
        CC CM² = Current Consumed CM²  |  TCCM² = Total Cumulative Meter Reading  |  PC CM² = Previous Consumed CM²
      </div>

      {verifyGcash && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form
            className="bg-white rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              confirmGcashReference();
            }}
          >
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">Verify GCash payment</h2>
              <p className="text-xs text-slate-500 mt-1">
                {verifyGcash.mode === "manual"
                  ? "Enter the reference from the GCash transaction you verified. It will be recorded with this payment."
                  : "Enter the reference from your GCash transaction. The payment is confirmed only if it matches the resident's submission."}
              </p>
            </div>
            <div className="p-5 text-sm text-slate-600 space-y-3">
              <div className="flex justify-between gap-4">
                <span>Household</span>
                <span className="font-semibold text-slate-800">{verifyGcash.id} — {verifyGcash.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Amount</span>
                <span className="font-semibold text-slate-800">{peso(verifyGcash.amount)}</span>
              </div>
              {verifyGcash.residentReference && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div className="text-xs font-semibold text-blue-600 mb-1">Resident's submitted reference</div>
                  <div className="text-sm font-mono text-slate-800 break-all">{verifyGcash.residentReference}</div>
                </div>
              )}
              <label className="block">
                <span className="block text-xs font-semibold text-slate-500 mb-1">Reference from GCash transaction record</span>
                <input
                  value={adminReference}
                  onChange={(event) => setAdminReference(event.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={80}
                  required
                  autoComplete="off"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="Enter the verified reference"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" onClick={() => setVerifyGcash(null)}>Cancel</Btn>
                <button
                  type="submit"
                  disabled={!adminReference.trim()}
                  className="bg-[#0072CE] hover:bg-[#005ea3] text-white text-xs font-semibold px-3 py-2 rounded-md disabled:opacity-50"
                >
                  {verifyGcash.mode === "manual" ? "Record verified payment" : "Confirm verified payment"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmPay && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setConfirmPay(null)}
        >
          <div
            className="bg-white rounded-2xl w-80 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="font-bold text-slate-800">
                {confirmPay.action === "unpaid" ? "Mark bill as unpaid?" : "Mark bill as paid?"}
              </div>
            </div>
            <div className="p-5 text-sm text-slate-600">
              <p className="mb-4">
                {confirmPay.action === "unpaid" ? "Revert the recorded payment of " : "Record a payment of "}
                <span className="font-semibold text-slate-800">{peso(confirmPay.amt)}</span> for{" "}
                <span className="font-semibold text-slate-800">{confirmPay.id} — {confirmPay.name}</span>
                {confirmPay.action === "unpaid" ? " back to unpaid?" : "?"}
              </p>
              {confirmPay.action === "paid" && (
                <div className="mb-4">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Payment method</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPayMethod("Offline")}
                      className={`flex-1 text-[12px] font-semibold py-2 rounded-lg border transition ${
                        payMethod === "Offline"
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      onClick={openManualGcashVerification}
                      className={`flex-1 text-[12px] font-semibold py-2 rounded-lg border transition ${
                        payMethod === "GCash"
                          ? "bg-[#0072CE] border-[#0072CE] text-white"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      GCash
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Btn onClick={() => setConfirmPay(null)}>Cancel</Btn>
                <Btn variant="primary" onClick={confirmPayment}>
                  {confirmPay.action === "unpaid" ? "Mark unpaid" : "Mark paid"}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AlertsPage({ alerts, filter, setFilter, selectedAlertId, setSelectedAlertId, resolveAlert, unresolveAlert }) {
  const filters = ["All", "Unresolved", "High Flow", "Leak Detected", "No Data", "Resolved"];
  const counts = {
    All: alerts.length,
    Unresolved: alerts.filter((a) => a.status === "Unresolved").length,
    "High Flow": alerts.filter((a) => a.type === "High Flow").length,
    "Leak Detected": alerts.filter((a) => a.type === "Leak Detected").length,
    "No Data": alerts.filter((a) => a.type === "No Sensor Data").length,
    Resolved: alerts.filter((a) => a.status === "Resolved").length,
  };

  const filtered = alerts.filter((a) => {
    if (filter === "All") return true;
    if (filter === "Unresolved") return a.status === "Unresolved";
    if (filter === "Resolved") return a.status === "Resolved";
    if (filter === "No Data") return a.type === "No Sensor Data";
    return a.type === filter;
  });

  const selected = alerts.find((a) => a.id === selectedAlertId) || filtered[0];

  // The alert opened in the zoomed-in detail modal (via View or a row click).
  const [viewId, setViewId] = useState(null);
  const viewed = viewId ? alerts.find((a) => a.id === viewId) : null;

  function openDetail(id) {
    setSelectedAlertId(id); // keep the row highlighted underneath
    setViewId(id);
  }

  const typeColor = (t) =>
    t === "Leak Detected" ? "text-rose-600" : t === "High Flow" ? "text-amber-600" : "text-slate-400";

  return (
    <>
      <SectionHeader title="Abnormal Consumption Alerts" sub="Real-time detection of unusual water flow per household connection" />
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition ${
              filter === f ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap mb-4">
        <StatCard label="Total alerts (today)" value={counts.All} accent="border-t-slate-300" />
        <StatCard label="High flow" value={counts["High Flow"]} tone="warn" accent="border-t-amber-400" />
        <StatCard label="Leak detected" value={counts["Leak Detected"]} tone="bad" accent="border-t-rose-400" />
        <StatCard label="No sensor data" value={counts["No Data"]} accent="border-t-slate-300" />
      </div>

      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden mb-3">
        <div className="px-4 py-2.5 text-[13px] font-semibold text-slate-700 border-b border-slate-100">Alert log — {dateStamp()}, {new Date().getFullYear()}</div>
        <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left px-3 py-2 font-medium">Alert ID</th>
              <th className="text-left px-3 py-2 font-medium">Household</th>
              <th className="text-left px-3 py-2 font-medium">Resident name</th>
              <th className="text-right px-3 py-2 font-medium">Standpost #</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-right px-3 py-2 font-medium">Flow rate</th>
              <th className="text-right px-3 py-2 font-medium">Threshold</th>
              <th className="text-right px-3 py-2 font-medium">Time</th>
              <th className="text-center px-3 py-2 font-medium">Status</th>
              <th className="text-center px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => (
              <tr
                key={a.id}
                onClick={() => openDetail(a.id)}
                className={`cursor-pointer ${selected?.id === a.id ? "bg-sky-50" : i % 2 ? "bg-slate-50" : "bg-white"} hover:bg-sky-50`}
              >
                <td className="px-3 py-1.5 text-slate-500">{a.id}</td>
                <td className="px-3 py-1.5 font-medium text-slate-700">{a.householdId}</td>
                <td className="px-3 py-1.5 text-slate-600">{a.name}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{a.standpost}</td>
                <td className={`px-3 py-1.5 ${a.type === "Leak Detected" ? "text-rose-600" : a.type === "High Flow" ? "text-amber-600" : "text-slate-400"}`}>{a.type}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{a.flowRate}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">{a.threshold}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">{a.time}</td>
                <td className="px-3 py-1.5 text-center">
                  {a.status === "Unresolved" ? <Badge tone="bad">Unresolved</Badge> : <Badge tone="good">Resolved</Badge>}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {a.status === "Unresolved" ? (
                    <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); resolveAlert(a.id); }}>
                      Resolve
                    </Btn>
                  ) : (
                    <div className="flex items-center justify-center gap-3">
                      <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(a.id); }}>View</Btn>
                      <Btn variant="ghostMuted" onClick={(e) => { e.stopPropagation(); unresolveAlert(a.id); }}>Unresolve</Btn>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center text-slate-400 py-6 text-xs">No alerts match this filter.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {viewed && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setViewId(null)}
        >
          <div
            className="bg-white rounded-2xl w-[420px] max-w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Alert detail</div>
                <div className="font-bold text-slate-800 text-lg">{viewed.id}</div>
              </div>
              <button onClick={() => setViewId(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-semibold text-slate-800">{viewed.name}</div>
                  <div className="text-xs text-slate-500">{viewed.householdId} · Standpost #{viewed.standpost}</div>
                </div>
                {viewed.status === "Unresolved" ? <Badge tone="bad">Unresolved</Badge> : <Badge tone="good">Resolved</Badge>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Type</div>
                  <div className={`font-semibold ${typeColor(viewed.type)}`}>{viewed.type}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Time</div>
                  <div className="font-semibold text-slate-700">{viewed.time}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Flow rate</div>
                  <div className="font-semibold text-slate-700">{viewed.flowRate}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Threshold</div>
                  <div className="font-semibold text-slate-700">{viewed.threshold}</div>
                </div>
              </div>

              <div className="flex gap-2 justify-end mt-5">
                <Btn onClick={() => setViewId(null)}>Close</Btn>
                {viewed.status === "Unresolved" ? (
                  <Btn variant="primary" onClick={() => { setViewId(null); resolveAlert(viewed.id); }}>Mark as Resolved</Btn>
                ) : (
                  <Btn variant="primary" onClick={() => { setViewId(null); unresolveAlert(viewed.id); }}>Mark as Unresolved</Btn>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function LeakReportsPage({ leakReports, resolveLeakReport, reopenLeakReport }) {
  const [filter, setFilter] = useState("All");
  const [viewId, setViewId] = useState(null);

  const filters = ["All", "Open", "Resolved"];
  const counts = {
    All: leakReports.length,
    Open: leakReports.filter((r) => r.status === "Open").length,
    Resolved: leakReports.filter((r) => r.status === "Resolved").length,
  };

  const filtered = leakReports.filter((r) => filter === "All" || r.status === filter);
  const viewed = viewId ? leakReports.find((r) => r.id === viewId) : null;

  const severityColor = (s) =>
    s === "major" ? "text-rose-600" : s === "moderate" ? "text-amber-600" : "text-slate-500";

  return (
    <>
      <SectionHeader title="Resident Leak Reports" sub="Water leaks and pipe issues reported by residents" />

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition ${
              filter === f ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap mb-4">
        <StatCard label="Total reports" value={counts.All} accent="border-t-slate-300" />
        <StatCard label="Open" value={counts.Open} tone="bad" accent="border-t-rose-400" />
        <StatCard label="Resolved" value={counts.Resolved} tone="good" accent="border-t-emerald-400" />
      </div>

      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[720px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left px-3 py-2 font-medium">Report ID</th>
                <th className="text-left px-3 py-2 font-medium">Household</th>
                <th className="text-left px-3 py-2 font-medium">Resident name</th>
                <th className="text-left px-3 py-2 font-medium">Location</th>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                <th className="text-center px-3 py-2 font-medium">Contact back</th>
                <th className="text-right px-3 py-2 font-medium">Reported</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.id}
                  onClick={() => setViewId(r.id)}
                  className={`cursor-pointer ${i % 2 ? "bg-slate-50" : "bg-white"} hover:bg-sky-50`}
                >
                  <td className="px-3 py-1.5 text-slate-500">{r.id}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-700">{r.householdId}</td>
                  <td className="px-3 py-1.5 text-slate-600">{r.name}</td>
                  <td className="px-3 py-1.5 text-slate-600">{r.location}</td>
                  <td className={`px-3 py-1.5 capitalize ${severityColor(r.severity)}`}>{r.severity}</td>
                  <td className="px-3 py-1.5 text-center text-slate-500">{r.contactBack ? "Yes" : "No"}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{r.time}</td>
                  <td className="px-3 py-1.5 text-center">
                    {r.status === "Open" ? <Badge tone="bad">Open</Badge> : <Badge tone="good">Resolved</Badge>}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {r.status === "Open" ? (
                      <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); resolveLeakReport(r.id); }}>
                        Resolve
                      </Btn>
                    ) : (
                      <Btn variant="ghostMuted" onClick={(e) => { e.stopPropagation(); reopenLeakReport(r.id); }}>
                        Reopen
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-6 text-xs">No leak reports match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewed && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setViewId(null)}
        >
          <div
            className="bg-white rounded-2xl w-[420px] max-w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Leak report</div>
                <div className="font-bold text-slate-800 text-lg">{viewed.id}</div>
              </div>
              <button onClick={() => setViewId(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-semibold text-slate-800">{viewed.name}</div>
                  <div className="text-xs text-slate-500">{viewed.householdId} · Standpost #{viewed.standpost}</div>
                </div>
                {viewed.status === "Open" ? <Badge tone="bad">Open</Badge> : <Badge tone="good">Resolved</Badge>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-[13px] mb-3">
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Location</div>
                  <div className="font-semibold text-slate-700">{viewed.location}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Severity</div>
                  <div className={`font-semibold capitalize ${severityColor(viewed.severity)}`}>{viewed.severity}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Reported</div>
                  <div className="font-semibold text-slate-700">{viewed.time}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">Contact back requested</div>
                  <div className="font-semibold text-slate-700">{viewed.contactBack ? "Yes" : "No"}</div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg px-3 py-2 text-[13px] mb-4">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Description</div>
                <div className="text-slate-700">{viewed.description}</div>
              </div>

              <div className="flex gap-2 justify-end">
                <Btn onClick={() => setViewId(null)}>Close</Btn>
                {viewed.status === "Open" ? (
                  <Btn variant="primary" onClick={() => { setViewId(null); resolveLeakReport(viewed.id); }}>Mark as Resolved</Btn>
                ) : (
                  <Btn variant="primary" onClick={() => { setViewId(null); reopenLeakReport(viewed.id); }}>Reopen</Btn>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Freshness-based status for a household's flow-sensor device (thresholds
// in src/deviceStatus.js, shared with the resident view).
function DeviceStatusBadge({ household }) {
  const status = deviceStatus(household);
  return <span className={`${status.tone} font-medium`}>{status.label}</span>;
}

// Liters used in each of the last 60 seconds, newest on the right. The device
// reports every ~15s, and each report carries its per-second counts, so the
// chart gains ~15 bars at a time (and lags live by up to ~15s).
// Kept only in the browser, so it starts empty when the page loads.
const PER_SECOND_SLOTS = 60;

function PerSecondUsageChart({ liters }) {
  const [hovered, setHovered] = useState(null);

  if (!liters.length) {
    return (
      <div className="rounded-lg border border-slate-100 px-3 py-2 text-[11px] text-slate-400">
        Per-second usage appears here with the next report from the sensor (within about 15 seconds; needs the updated ESP firmware).
      </div>
    );
  }

  const slots = [...Array(Math.max(0, PER_SECOND_SLOTS - liters.length)).fill(null), ...liters];
  const max = Math.max(0.05, ...liters);
  const total = liters.reduce((sum, l) => sum + l, 0);

  return (
    <div className="rounded-lg border border-slate-100 px-3 py-2">
      <div className="flex items-baseline justify-between text-[11px] mb-1.5">
        <span className="text-slate-500 font-medium">Per-second usage</span>
        <span className="text-slate-600">
          {hovered
            ? `${hovered.ago}s ago: ${hovered.liters.toFixed(3)} L`
            : `Last ${liters.length} s: ${total.toFixed(2)} L`}
        </span>
      </div>
      <div
        className="flex items-end gap-[2px] h-16 border-b border-slate-200"
        role="img"
        aria-label={`Liters used per second over the last ${liters.length} seconds; ${total.toFixed(2)} L in total.`}
        onMouseLeave={() => setHovered(null)}
      >
        {slots.map((l, i) => (
          <div
            key={i}
            className="flex-1 h-full flex items-end"
            onMouseEnter={() => l !== null && setHovered({ liters: l, ago: PER_SECOND_SLOTS - 1 - i })}
          >
            {l !== null && (
              <div
                className={`w-full rounded-t ${hovered && hovered.ago === PER_SECOND_SLOTS - 1 - i ? "bg-sky-700" : "bg-sky-500"}`}
                style={{ height: `${(l / max) * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>60 s ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

// Provisioning + calibration UI for one household's Arduino/ESP flow-sensor
// device. Lives inside the expanded household card in HouseholdsPage.
function DeviceManager({ household, onProvisionDevice, onRevokeDevice, onSetDeviceCalibration, showToast }) {
  const [revealedKey, setRevealedKey] = useState(null);
  const [calibration, setCalibration] = useState(household.pulsesPerLiter);
  const [busy, setBusy] = useState(false);
  const [highFlow, setHighFlow] = useState(null);

  // The household's own High Flow threshold, learned by the server from its
  // usage history. It moves slowly (days of data), so fetching it when the
  // card opens is enough — no need to follow every live reading.
  useEffect(() => {
    if (!household.deviceProvisioned) return;
    let cancelled = false;
    fetchDeviceStatus(household.id)
      .then((status) => {
        if (!cancelled) setHighFlow(status.highFlow || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [household.id, household.deviceProvisioned]);

  useEffect(() => {
    setCalibration(household.pulsesPerLiter);
  }, [household.pulsesPerLiter]);

  async function handleProvision() {
    setBusy(true);
    try {
      const key = await onProvisionDevice?.(household.id);
      if (key) setRevealedKey(key);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    try {
      await onRevokeDevice?.(household.id);
      setRevealedKey(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCalibration() {
    const value = Number(calibration);
    if (!Number.isFinite(value) || value <= 0) {
      showToast?.("Calibration must be a positive number.", "warn");
      return;
    }
    setBusy(true);
    try {
      await onSetDeviceCalibration?.(household.id, value);
    } finally {
      setBusy(false);
    }
  }

  function copyKey() {
    if (!navigator.clipboard) {
      showToast?.("Clipboard unavailable — copy the key manually.", "warn");
      return;
    }
    navigator.clipboard.writeText(revealedKey).then(
      () => showToast?.("Device key copied to clipboard.", "success"),
      () => showToast?.("Could not copy — copy it manually.", "warn")
    );
  }

  return (
    <div className="pt-2 mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-700">IoT flow sensor</span>
        <DeviceStatusBadge household={household} />
      </div>

      {revealedKey && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-2 space-y-1">
          <div className="text-amber-800 font-medium">Copy this key now — it won't be shown again.</div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 bg-white border border-amber-200 rounded px-1.5 py-1 text-[10px] break-all">
              {revealedKey}
            </code>
            <Btn variant="outline" onClick={copyKey}>Copy</Btn>
          </div>
          <div className="text-[10px] text-amber-700">
            Paste it into the firmware's <code>config.h</code> as <code>DEVICE_KEY</code>, then flash/reboot the device.
          </div>
        </div>
      )}

      {highFlow && (
        <div className="text-slate-500">
          High-flow alert at: <span className="font-medium text-slate-700">{highFlow.thresholdLpm} L/min</span>{" "}
          <span className="text-[10px] text-slate-400">
            {highFlow.learned
              ? `learned from this household's usage (typical peak ${highFlow.typicalPeakLpm} L/min)`
              : `default — learning (${highFlow.samples} readings of usage so far)`}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-slate-500">Calibration:</label>
        <input
          type="number"
          min="1"
          step="any"
          value={calibration}
          onChange={(e) => setCalibration(e.target.value)}
          className="w-20 border border-slate-300 rounded px-1.5 py-1 text-[13px]"
        />
        <span className="text-slate-400">pulses/L</span>
        <Btn variant="outline" onClick={handleSaveCalibration} disabled={busy}>Save</Btn>
      </div>

      <div className="flex items-center gap-2">
        <Btn variant="outline" onClick={handleProvision} disabled={busy}>
          {household.deviceProvisioned ? "Regenerate key" : "Generate device key"}
        </Btn>
        {household.deviceProvisioned && (
          <Btn variant="ghostMuted" onClick={handleRevoke} disabled={busy}>Revoke</Btn>
        )}
      </div>
    </div>
  );
}

// Shown on a household's card when the resident has filed a "forgot
// password" request. No verification code involved — the admin types the
// new password here and confirms it directly.
function PasswordResetRequestBanner({ household, onConfirmPasswordReset, showToast }) {
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (newPassword.length < 8) {
      showToast?.("New password must be at least 8 characters.", "warn");
      return;
    }
    setBusy(true);
    try {
      const result = await onConfirmPasswordReset?.(household.id, newPassword);
      if (result && result.success) {
        setNewPassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-2">
      <div className="text-amber-800 font-semibold">🔔 Password reset requested</div>
      <div className="text-amber-700">Set a new password for this resident and confirm it — no code needed.</div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="flex-1 min-w-[140px] border border-amber-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:border-amber-500"
        />
        <Btn variant="primary" onClick={handleConfirm} disabled={busy}>
          {busy ? "Setting…" : "Set & Confirm"}
        </Btn>
      </div>
    </div>
  );
}

export function HouseholdsPage({
  households,
  showToast,
  onResetPassword,
  onConfirmPasswordReset,
  onAddHousehold,
  onProvisionDevice,
  onRevokeDevice,
  onSetDeviceCalibration,
}) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [expandedId, setExpandedId] = React.useState(null);
  const [selectedPurok, setSelectedPurok] = React.useState("All Puroks");
  const [showAddModal, setShowAddModal] = React.useState(false);

  // DeviceStatusBadge reads Date.now() at render time, so without new data
  // arriving (a fresh reading, a page action) it would never notice a device
  // has gone quiet. This just forces a re-render periodically so "Online"
  // ages into "Offline" on screen even when nothing else changes.
  const [, forceTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), DEVICE_STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const searchFiltered = households.filter(
    (h) =>
      h.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(h.standpost).includes(searchTerm) ||
      h.meter.toLowerCase().includes(searchTerm.toLowerCase()) ||
      householdPurok(h).toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filtered = searchFiltered.filter((household) =>
    selectedPurok === "All Puroks" || householdPurok(household) === selectedPurok
  );
  const purokOptions = ["All Puroks", ...PUROK_GROUPS];
  if (households.some((household) => householdPurok(household) === "Other")) purokOptions.push("Other");

  return (
    <>
      <SectionHeader title="Household Records" sub="Connected households under the barangay water system" />

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs text-slate-500 mb-1.5">Search by household ID, resident, standpost, or meter #</label>
          <input
            type="text"
            placeholder="e.g., HH-001, Juan dela Cruz, 25"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>
        <div className="text-xs text-slate-500">
          {searchTerm || selectedPurok !== "All Puroks"
            ? `${filtered.length} of ${households.length} households`
            : `${households.length} total households`}
        </div>
        <Btn variant="primary" onClick={() => setShowAddModal(true)}>+ Add Household</Btn>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter households by Purok">
        <span className="text-xs font-semibold text-slate-500 mr-1">By Purok</span>
        {purokOptions.map((purok) => {
          const count = purok === "All Puroks"
            ? households.length
            : households.filter((household) => householdPurok(household) === purok).length;
          return (
            <button
              key={purok}
              type="button"
              aria-pressed={selectedPurok === purok}
              onClick={() => setSelectedPurok(purok)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md border transition ${
                selectedPurok === purok
                  ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {purok} <span className={selectedPurok === purok ? "text-white/75" : "text-slate-400"}>({count})</span>
            </button>
          );
        })}
      </div>
          {searchTerm || selectedPurok !== "All Puroks"
            ? `${filtered.length} of ${households.length} households`
            : `${households.length} total households`}

      {showAddModal && (
        <AddHouseholdModal
          onAdd={onAddHousehold}
          showToast={showToast}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {filtered.length > 0 ? (
        <div className="columns-1 sm:columns-2 gap-3">
          {filtered.map((h) => {
            const isExpanded = expandedId === h.id;
            const isDimmed = expandedId !== null && !isExpanded;
            return (
              <div
                key={h.id}
                className={`card-hover bg-white rounded-lg border p-3.5 mb-3 break-inside-avoid-column cursor-pointer motion-safe:hover:-translate-y-0.5 transition-all duration-200 ${
                  isExpanded
                    ? "border-slate-800 ring-2 ring-slate-300 shadow-[0_0_16px_rgba(0,0,0,0.35)]"
                    : isDimmed
                    ? "border-slate-200 opacity-40 saturate-50"
                    : "border-slate-200"
                }`}
              >
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedId(isExpanded ? null : h.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-slate-800 text-base">{h.name}</div>
                    <div className="flex items-center gap-1.5">
                      {h.passwordResetRequested && <Badge tone="warn">🔔 Password reset</Badge>}
                      {h.flowType === "High flow" && <Badge tone="bad">High Flow</Badge>}
                      <Badge tone="good">Active</Badge>
                    </div>
                  </div>
                  <div className="text-[13px] text-slate-500 space-y-1">
                    <div>Household ID: <span className="text-slate-700 font-medium">{h.id}</span></div>
                    <div>Purok: <span className="text-slate-700 font-medium">{householdPurok(h)}</span></div>
                    <div>Standpost #: <span className="text-slate-700 font-medium">{h.standpost}</span></div>
                    <div>Meter #: <span className="text-slate-700 font-medium">{h.meter}</span></div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-[13px] text-slate-600 space-y-2.5">
                    {h.passwordResetRequested && (
                      <PasswordResetRequestBanner
                        household={h}
                        onConfirmPasswordReset={onConfirmPasswordReset}
                        showToast={showToast}
                      />
                    )}
                    {(() => {
                      // An offline sensor's last flow value is stale, not
                      // "live" — show it only while the device is reporting.
                      const online = isDeviceOnline(h);
                      const flowing = online && (h.lastFlow || 0) > 0;
                      const isHighFlow = online && h.flowType === "High flow";
                      return (
                        <div
                          className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                            isHighFlow ? "bg-amber-50" : flowing ? "bg-sky-50" : "bg-slate-50"
                          }`}
                        >
                          <span className="text-slate-500 font-medium">Live flow</span>
                          {online ? (
                            <span className={`text-xl font-bold ${isHighFlow ? "text-amber-700" : flowing ? "text-sky-700" : "text-slate-600"}`}>
                              {(h.lastFlow || 0).toFixed(1)} <span className="text-xs font-medium">L/min</span>
                              {isHighFlow && <span className="ml-1.5 text-xs font-semibold text-amber-600">High flow</span>}
                            </span>
                          ) : (
                            <span className="text-[13px] font-medium text-slate-400">
                              {!h.deviceProvisioned
                                ? "No sensor connected"
                                : h.deviceLastSeen
                                ? "— Sensor offline"
                                : "Awaiting first reading"}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    {isDeviceOnline(h) && <PerSecondUsageChart liters={h.perSecondLiters || []} />}
                    <div className="grid grid-cols-2 gap-2">
                      <div>Current reading: <span className="font-semibold text-slate-800">{h.currCm3} CM³</span></div>
                      <div>Previous reading: <span className="font-semibold text-slate-800">{h.prevCm3} CM³</span></div>
                      <div>This cycle: <span className="font-semibold text-slate-800">{h.consumption} CM³</span></div>
                      <div>Amount due: <span className="font-semibold text-slate-800">{peso(h.amount)}</span></div>
                      <div>Total due: <span className="font-semibold text-slate-800">{peso(h.totalDue)}</span></div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span>
                        Payment status:{" "}
                        {h.paymentStatus === "Paid" ? (
                          <Badge tone="good">Paid</Badge>
                        ) : h.paymentStatus === "GCash Pending" ? (
                          <Badge tone="info">GCash Pending</Badge>
                        ) : h.paymentStatus === "Cash Pending" ? (
                          <Badge tone="warn">Cash Pending</Badge>
                        ) : (
                          <Badge tone="bad">Unpaid</Badge>
                        )}
                      </span>
                      <span>
                        Account: {h.password ? (
                          <span className="text-emerald-600 font-medium">Password set</span>
                        ) : (
                          <span className="text-amber-600 font-medium">Not yet activated</span>
                        )}
                      </span>
                    </div>
                    {h.password && (
                      <div className="pt-1">
                        <Btn
                          variant="outline"
                          onClick={() => {
                            if (typeof onResetPassword === "function") {
                              onResetPassword(h.id);
                            } else if (typeof showToast === "function") {
                              showToast(`${h.id} password reset — resident must set a new one on next login.`, "info");
                            }
                          }}
                        >
                          Reset password
                        </Btn>
                      </div>
                    )}

                    <DeviceManager
                      household={h}
                      onProvisionDevice={onProvisionDevice}
                      onRevokeDevice={onRevokeDevice}
                      onSetDeviceCalibration={onSetDeviceCalibration}
                      showToast={showToast}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-slate-500">
          No households found for {selectedPurok}{searchTerm ? ` matching "${searchTerm}"` : ""}.
        </div>
      )}
    </>
  );
}

function AddHouseholdModal({ onAdd, showToast, onClose }) {
  const [form, setForm] = React.useState({
    name: "",
    standpost: "",
    meter: "",
    address: "",
    phone: "",
    email: "",
  });
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.name.trim() || !form.standpost || !form.meter.trim()) {
      setError("Full name, standpost #, and meter # are required.");
      return;
    }
    const standpostNum = Number(form.standpost);
    if (!Number.isFinite(standpostNum) || standpostNum <= 0) {
      setError("Standpost # must be a positive number.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await onAdd({
        name: form.name.trim(),
        standpost: standpostNum,
        meter: form.meter.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      });
      if (!result || !result.success) {
        setError((result && result.message) || "Could not add household.");
        return;
      }
      onClose();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-[#1e3a5f] text-white px-5 py-4 flex items-center justify-between sticky top-0">
          <div className="font-bold text-sm">Add Household</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-lg leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <p className="text-[11px] text-slate-500 -mt-1 mb-1">
            A household ID and standpost connection will be generated automatically.
          </p>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-[11px] text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-slate-600 block mb-1">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
              placeholder="e.g., Juan dela Cruz"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">
                Standpost # <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                value={form.standpost}
                onChange={(e) => setField("standpost", e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                placeholder="e.g., 25"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">
                Meter # <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.meter}
                onChange={(e) => setField("meter", e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                placeholder="e.g., 158-SH-00099"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-600 block mb-1">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setField("address", e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
              placeholder="Purok, Kinamlutan, Butuan City"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                placeholder="09XX XXX XXXX"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Email</label>
              <input
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
                placeholder="name@gmail.com"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Btn type="button" className="flex-1 justify-center" onClick={onClose}>Cancel</Btn>
            <Btn
              type="submit"
              variant="primary"
              className="flex-1 justify-center"
              disabled={submitting}
            >
              {submitting ? "Adding…" : "Add Household"}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}

const RECORDS_MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodSortKey(period) {
  const [month, year] = period.split(" ");
  return Number(year) * 12 + RECORDS_MONTH_ORDER.indexOf(month);
}

export function RecordsPage({ households, showToast }) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("All");

  const allRecords = households
    .flatMap((h) => h.history.map((rec) => ({ household: h, record: rec })))
    .sort((a, b) => periodSortKey(b.record.period) - periodSortKey(a.record.period));

  const filtered = allRecords.filter(({ household, record }) => {
    const matchesSearch =
      !searchTerm ||
      household.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      household.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "All" || (statusFilter === "Paid" ? record.paid : !record.paid);
    return matchesSearch && matchesStatus;
  });

  const totalRecords = allRecords.length;
  const paidCount = allRecords.filter(({ record }) => record.paid).length;
  const unpaidCount = totalRecords - paidCount;
  function exportCsv() {
    const header = ["Household", "Resident name", "Period", "Prev CM3", "Curr CM3", "Consumed", "Amount", "Status"];
    const rows = filtered.map(({ household, record }) => [
      household.id,
      household.name,
      record.period,
      record.prev,
      record.curr,
      record.curr - record.prev,
      record.amt,
      record.paid ? "Paid" : "Unpaid",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "billing-records-archive.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof showToast === "function") showToast("Records exported as CSV", "success");
  }

  return (
    <>
      <SectionHeader title="Records" sub="Historical consumption and billing archive" />

      <div className="flex gap-3 flex-wrap mb-4">
        <StatCard label="Total records" value={totalRecords} />
        <StatCard label="Paid" value={paidCount} tone="good" />
        <StatCard label="Unpaid" value={unpaidCount} tone="bad" />
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs text-slate-500 mb-1.5">Search by household ID or resident name</label>
          <input
            type="text"
            placeholder="e.g., HH-001, Juan dela Cruz"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {["All", "Paid", "Unpaid"].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition ${
                statusFilter === status
                  ? status === "Paid"
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : status === "Unpaid"
                    ? "bg-rose-600 text-white border-rose-600"
                    : "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <Btn onClick={() => window.print()}>Export PDF</Btn>
          <Btn onClick={exportCsv}>Export CSV</Btn>
        </div>
      </div>

      <div className="text-xs text-slate-500 mb-2">
        {searchTerm || statusFilter !== "All"
          ? `Showing ${filtered.length} of ${totalRecords} records`
          : `Showing all ${totalRecords} records`}
      </div>

      <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Household</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Resident name</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Period</th>
                <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Prev CM³</th>
                <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Curr CM³</th>
                <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Consumed</th>
                <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Amount</th>
                <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? (
                filtered.map(({ household, record }, i) => (
                  <tr key={household.id + record.period} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">{household.id}</td>
                    <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{household.name}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{record.period}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{record.prev}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{record.curr}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">{record.curr - record.prev}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-800 whitespace-nowrap">{peso(record.amt)}</td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      {record.paid ? <Badge tone="good">Paid</Badge> : <Badge tone="bad">Unpaid</Badge>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    No records match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function SettingsPage({ showToast, adminEmail }) {
  const [editing, setEditing] = React.useState(false);
  const [rate, setRate] = React.useState(RATE_PER_CM3);
  const [minBill, setMinBill] = React.useState(MIN_BILL);
  const [gateway, setGateway] = React.useState("GCash");

  function handleSave() {
    setEditing(false);
    if (typeof showToast === "function") {
      showToast("Settings updated for this session.", "success");
    }
  }

  return (
    <>
      <SectionHeader title="Settings" sub="System configuration" />
      <div className="grid gap-5 max-w-md">
        <div className="card-hover bg-white rounded-lg border border-slate-200 p-5 text-[12px] space-y-4">
          <div className="flex items-center justify-between pb-1">
            <span className="font-semibold text-slate-700 text-[13px]">Billing configuration</span>
            <button
              onClick={() => setEditing(!editing)}
              className="text-[12px] text-sky-600 hover:text-sky-800 font-medium"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500">Rate per CM³</span>
            {editing ? (
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-24 border border-slate-300 rounded-md px-2 py-1 text-right text-[12px] focus:outline-none focus:border-sky-400"
              />
            ) : (
              <span className="font-medium">{peso(rate)}</span>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500">Minimum billing</span>
            {editing ? (
              <input
                type="number"
                value={minBill}
                onChange={(e) => setMinBill(Number(e.target.value))}
                className="w-24 border border-slate-300 rounded-md px-2 py-1 text-right text-[12px] focus:outline-none focus:border-sky-400"
              />
            ) : (
              <span className="font-medium">{peso(minBill)}</span>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500">Current billing period</span>
            <span className="font-medium">{BILLING_PERIOD}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500">Payment gateway</span>
            {editing ? (
              <select
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-sky-400"
              >
                <option value="GCash">GCash</option>
                <option value="Maya">Maya</option>
                <option value="Cash only">Cash only</option>
              </select>
            ) : (
              <span className="font-medium">{gateway}</span>
            )}
          </div>

          {editing ? (
            <div className="pt-2 border-t border-slate-100">
              <Btn variant="primary" onClick={handleSave}>Save Changes</Btn>
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
              Changes apply to this session only and are not persisted to a backend in this prototype.
            </div>
          )}
        </div>

        <AlertDetectionSettingsCard showToast={showToast} />
        <StaffAccountsCard showToast={showToast} adminEmail={adminEmail} />
      </div>
    </>
  );
}

// Real-time leak / abnormal-usage detection thresholds — unlike the billing
// card above, these ARE persisted (server/src/utils/settings.js) and take
// effect immediately: routes/devices.js's real-time check and routes/data.js's
// per-cycle check both read them fresh on every run, no restart needed.
const ALERT_SETTINGS_FIELDS = [
  { key: "highFlowLpm", label: "High-flow minimum", unit: "L/min", help: "High Flow threshold until a household has usage history — and the lowest it can ever learn." },
  { key: "highFlowLearnMultiplier", label: "High-flow learning", unit: "× typical peak", help: "Each household's threshold = its own typical peak flow × this." },
  { key: "highFlowLearnDays", label: "Learn from last", unit: "days", help: "How much of a household's reading history the threshold is learned from." },
  { key: "highFlowMinSamples", label: "Learning starts after", unit: "readings", help: "Readings with water flowing needed before a household's threshold is learned." },
  { key: "highFlowMaxLpm", label: "High-flow maximum", unit: "L/min", help: "Learning never raises a threshold above this — a real burst is always flagged." },
  { key: "maxPlausibleFlowLpm", label: "Sensor fault above", unit: "L/min", help: "Faster than any real household flow = wiring noise. Discarded (not billed) and raises a \"Sensor Fault\" alert." },
  { key: "leakFlowLpm", label: "Leak flow floor", unit: "L/min", help: "Low but non-zero flow — the signature of a persistent drip." },
  { key: "leakSustainedMinutes", label: "Leak sustained for", unit: "min", help: "...continuously at/above the floor before it counts as a leak." },
  { key: "deviceSilenceMinutes", label: "Device silence", unit: "min", help: "No readings from a connected device for this long -> \"No Sensor Data\"." },
  { key: "highUsageRatio", label: "High usage ratio", unit: "× average", help: "A billing cycle at/above this multiple of a household's average." },
  { key: "leakUsageRatio", label: "Leak usage ratio", unit: "× average", help: "...at/above this multiple instead -> Leak Detected." },
];

function AlertDetectionSettingsCard({ showToast }) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [values, setValues] = React.useState({});
  const [draft, setDraft] = React.useState({});

  React.useEffect(() => {
    let cancelled = false;
    fetchAlertSettings()
      .then((settings) => {
        if (cancelled) return;
        setValues(settings);
        setDraft(settings);
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled && typeof showToast === "function") {
          showToast("Could not load alert thresholds: " + err.message, "warn");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line

  function startEditing() {
    setDraft(values);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAlertSettingsApi(draft);
      setValues(result.settings);
      setDraft(result.settings);
      setEditing(false);
      if (typeof showToast === "function") {
        showToast("Detection thresholds updated — takes effect immediately.", "success");
      }
    } catch (err) {
      if (typeof showToast === "function") {
        showToast("Could not save thresholds: " + err.message, "warn");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-hover bg-white rounded-lg border border-slate-200 p-5 text-[12px] space-y-4">
      <div className="flex items-center justify-between pb-1">
        <div>
          <div className="font-semibold text-slate-700 text-[13px]">Leak & Abnormal Usage Detection</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Real-time thresholds — saved to the server, effective immediately.</div>
        </div>
        {loaded && (
          <button
            onClick={() => (editing ? setEditing(false) : startEditing())}
            className="text-[12px] text-sky-600 hover:text-sky-800 font-medium shrink-0"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>

      {!loaded ? (
        <div className="text-slate-400 py-2">Loading…</div>
      ) : (
        <>
          {ALERT_SETTINGS_FIELDS.map((f) => (
            <div key={f.key} className="flex justify-between items-center gap-3">
              <div>
                <div className="text-slate-500">{f.label}</div>
                <div className="text-[10px] text-slate-400">{f.help}</div>
              </div>
              {editing ? (
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    step="any"
                    value={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="w-20 border border-slate-300 rounded-md px-2 py-1 text-right text-[12px] focus:outline-none focus:border-sky-400"
                  />
                  <span className="text-slate-400 whitespace-nowrap">{f.unit}</span>
                </div>
              ) : (
                <span className="font-medium shrink-0">{values[f.key]} {f.unit}</span>
              )}
            </div>
          ))}

          {editing && (
            <div className="pt-2 border-t border-slate-100">
              <Btn variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Per-person staff logins — see server/src/routes/adminAccounts.js for why:
// without this, the audit log can only ever say "admin@barangay.local" no
// matter which real staff member clicked the button, since everyone would
// otherwise be sharing one login.
function StaffAccountsCard({ showToast, adminEmail }) {
  const [accounts, setAccounts] = React.useState(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState("officer");
  const [busy, setBusy] = React.useState(false);

  function load() {
    fetchAdminAccounts()
      .then(setAccounts)
      .catch((err) => {
        if (typeof showToast === "function") showToast("Could not load staff accounts: " + err.message, "warn");
      });
  }

  React.useEffect(load, []); // eslint-disable-line

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createAdminAccount({ email, password, role, firstName, lastName });
      showToast?.(`Account created for ${firstName} ${lastName}.`, "success");
      setFirstName("");
      setLastName("");
      setEmail("");
      setPassword("");
      setRole("officer");
      setShowCreate(false);
      load();
    } catch (err) {
      showToast?.("Could not create account: " + err.message, "warn");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(accEmail) {
    if (!window.confirm(`Remove the account for ${accEmail}? They will no longer be able to sign in.`)) return;
    try {
      await deleteAdminAccount(accEmail);
      load();
      showToast?.(`Account removed for ${accEmail}.`, "success");
    } catch (err) {
      showToast?.("Could not remove account: " + err.message, "warn");
    }
  }

  return (
    <div className="card-hover bg-white rounded-lg border border-slate-200 p-5 text-[12px] space-y-3">
      <div className="flex items-center justify-between pb-1">
        <div>
          <div className="font-semibold text-slate-700 text-[13px]">Staff Accounts</div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            One login per person — needed so the audit log can tell staff apart.
          </div>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="text-[12px] text-sky-600 hover:text-sky-800 font-medium shrink-0"
        >
          {showCreate ? "Cancel" : "+ Add account"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="space-y-2 pb-3 border-b border-slate-100">
          <div className="flex gap-2">
            <input
              type="text"
              required
              autoComplete="off"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-1/2 border border-slate-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
            />
            <input
              type="text"
              required
              autoComplete="off"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-1/2 border border-slate-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
            />
          </div>
          <input
            type="email"
            required
            autoComplete="off"
            placeholder="name@barangay.local"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Temporary password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-sky-400"
          >
            <option value="officer">Officer — full access</option>
            <option value="collector">Collector — payments only</option>
          </select>
          <Btn variant="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Btn>
        </form>
      )}

      {accounts === null ? (
        <div className="text-slate-400 py-2">Loading…</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {accounts.map((acc) => (
            <div key={acc.email} className="flex items-center justify-between py-2 gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-700 truncate">
                  {acc.name || acc.email}
                  {adminEmail && acc.email.toLowerCase() === adminEmail.toLowerCase() && (
                    <span className="text-slate-400 font-normal"> (you)</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {acc.email} · <span className="capitalize">{acc.role}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(acc.email)}
                className="text-[11px] text-rose-500 hover:text-rose-700 font-medium shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BillStatementsPage({ households }) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("All");
  const [selectedIds, setSelectedIds] = React.useState(() => new Set());
  // While printing, holds the exact list of bills to render so only the chosen
  // ones make it into the PDF; null means "show the browsing list on screen".
  const [printList, setPrintList] = React.useState(null);

  const filtered = households.filter((h) => {
    if (statusFilter !== "All" && h.paymentStatus !== statusFilter) return false;
    return (
      h.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const toggleSelect = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allShownSelected = filtered.length > 0 && filtered.every((h) => selectedIds.has(h.id));

  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filtered.forEach((h) => next.delete(h.id));
      else filtered.forEach((h) => next.add(h.id));
      return next;
    });

  // Render `list` into the print grid, print, then restore the on-screen view.
  const printBills = (list) => {
    if (!list || list.length === 0) return;
    setPrintList(list);
    const cleanup = () => {
      setPrintList(null);
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.requestAnimationFrame(() => window.print());
  };

  const selectedBills = filtered.filter((h) => selectedIds.has(h.id));
  const printAllStatements = () => printBills(households);
  const renderList = printList || filtered;

  return (
    <>
      <SectionHeader title="Billing Statements" sub={`View and print resident bills — ${BILLING_PERIOD}`} />
      
      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs text-slate-500 mb-1.5">Search by household ID or resident name</label>
          <input
            type="text"
            placeholder="e.g., HH-001, Juan Dela Cruz"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {['All', 'Paid', 'Unpaid'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition ${
                statusFilter === status
                  ? status === 'Paid'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : status === 'Unpaid'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <Btn onClick={() => printBills(filtered)}>Print shown</Btn>
          <Btn
            variant="primary"
            disabled={selectedBills.length === 0}
            onClick={() => printBills(selectedBills)}
          >
            Print selected ({selectedBills.length})
          </Btn>
          <Btn variant="secondary" onClick={printAllStatements}>Print all statements</Btn>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="text-xs text-slate-500">
          {searchTerm || statusFilter !== "All"
            ? `Showing ${filtered.length} ${statusFilter === "All" ? "household" : `${statusFilter.toLowerCase()} household`}${filtered.length !== 1 ? "s" : ""}`
            : `Displaying all ${households.length} households`}
        </div>
        {filtered.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={toggleSelectAll}
              className="check-circle"
            />
            Select all shown
          </label>
        )}
        {selectedIds.size > 0 && (
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-sky-600 hover:underline">
            Clear selection ({selectedIds.size})
          </button>
        )}
      </div>

      <div className="print-bills-grid">
        {renderList.length > 0 ? (
          chunk(renderList, 2).map((pair) => (
            <div key={pair.map((h) => h.id).join("-")} className="print-bill-page">
              {pair.map((household, idx) => (
                <div key={household.id} className="print-bill-item">
                  <div className="no-print w-full max-w-[640px] mx-auto mb-1.5">
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(household.id)}
                        onChange={() => toggleSelect(household.id)}
                        className="check-circle"
                      />
                      Include in print — {household.id} · {household.name}
                    </label>
                  </div>
                  <BillReplica me={household} paymentStamp={household.paymentStamp} />
                  {/* Dashed cut line between the two bills sharing a sheet. */}
                  {idx < pair.length - 1 && (
                    <div className="bill-separator w-full mt-6 border-t-2 border-dashed border-slate-400" />
                  )}
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-slate-500">
            No households found matching "{searchTerm}". Try searching by household ID or resident name.
          </div>
        )}
      </div>
    </>
  );
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────
// ANNOUNCEMENTS (admin management) — Water Officer only.
// Posts here appear on every resident's Announcements page.
// ─────────────────────────────────────────────────────────────
const ANN_TYPES = [
  { value: "info", label: "Info", badge: "bg-sky-100 text-sky-700", dot: "bg-sky-500" },
  { value: "success", label: "Update", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { value: "warn", label: "Advisory", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
];

function annStyle(type) {
  return ANN_TYPES.find((t) => t.value === type) || ANN_TYPES[0];
}

const EMPTY_ANN = () => ({
  type: "info",
  title: "",
  tag: "",
  content: "",
  date: new Date().toISOString().slice(0, 10),
});

export function AnnouncementsPage({ showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | announcement object
  const [form, setForm] = useState(EMPTY_ANN());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await fetchAnnouncements());
    } catch (err) {
      showToast("Could not load announcements: " + err.message, "warn");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  function startNew() { setForm(EMPTY_ANN()); setEditing("new"); }
  function startEdit(a) {
    setForm({ type: a.type, title: a.title, tag: a.tag || "", content: a.content, date: a.date });
    setEditing(a);
  }
  function cancel() { setEditing(null); setForm(EMPTY_ANN()); }

  async function save(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      showToast("Title and content are required.", "warn");
      return;
    }
    setSaving(true);
    try {
      if (editing === "new") {
        await createAnnouncement(form);
        showToast("Announcement posted.", "success");
      } else {
        await updateAnnouncement(editing.id, form);
        showToast("Announcement updated.", "success");
      }
      cancel();
      await load();
    } catch (err) {
      showToast("Could not save announcement: " + err.message, "warn");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    setConfirmDelete(null);
    try {
      await deleteAnnouncement(id);
      showToast("Announcement deleted.", "success");
      await load();
    } catch (err) {
      showToast("Could not delete announcement: " + err.message, "warn");
    }
  }

  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f] transition";

  return (
    <>
      <SectionHeader title="Announcements" sub="Post updates that appear on every resident's portal" />

      {!editing && (
        <div className="mb-4">
          <Btn variant="primary" onClick={startNew}>+ New announcement</Btn>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="card-hover bg-white rounded-lg border border-slate-200 p-4 mb-5">
          <div className="font-semibold text-[13px] text-slate-700 mb-3">
            {editing === "new" ? "New announcement" : "Edit announcement"}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">Title</label>
              <input className={inputCls} value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g., Scheduled Water Interruption" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">Category tag</label>
              <input className={inputCls} value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                placeholder="e.g., Maintenance" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">Type</label>
              <select className={inputCls} value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {ANN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">Date</label>
              <input type="date" className={inputCls} value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[11px] font-semibold text-slate-600 block mb-1">Message</label>
            <textarea className={`${inputCls} resize-y`} rows={4} value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="Write the announcement details residents will see…" />
          </div>
          <div className="flex gap-2 justify-end">
            <Btn onClick={cancel}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing === "new" ? "Post announcement" : "Save changes"}
            </Btn>
          </div>
        </form>
      )}

      {loading ? (
        <div className="py-10 text-center text-[12px] text-slate-400">Loading announcements…</div>
      ) : items.length === 0 ? (
        <div className="card-hover bg-white rounded-lg border border-slate-200 py-10 text-center text-[12px] text-slate-400">
          No announcements yet. Post one to notify residents.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const style = annStyle(a.type);
            return (
              <div key={a.id} className="card-hover bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${style.dot}`} />
                    <div className="min-w-0">
                      <div className="font-semibold text-[13px] text-slate-800">{a.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {a.tag && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.badge}`}>{a.tag}</span>
                        )}
                        <span className="text-[10px] text-slate-400">{a.date}</span>
                      </div>
                      <div className="text-[12px] text-slate-600 mt-1.5 leading-relaxed">{a.content}</div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Btn variant="ghost" onClick={() => startEdit(a)}>Edit</Btn>
                    <Btn variant="ghostMuted" onClick={() => setConfirmDelete(a)}>Delete</Btn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl w-80 overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="font-bold text-slate-800">Delete announcement?</div>
            </div>
            <div className="p-5 text-sm text-slate-600">
              <p className="mb-4">
                Remove <span className="font-semibold text-slate-800">"{confirmDelete.title}"</span>? Residents will no longer see it.
              </p>
              <div className="flex gap-2 justify-end">
                <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                <Btn variant="primary" onClick={() => remove(confirmDelete.id)}>Delete</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// AUDIT LOG (read-only) — Water Officer only.
// Shows who did what (staff email + role + action + timestamp).
// ─────────────────────────────────────────────────────────────
const AUDIT_ACTIONS = {
  "bill.mark_paid": { label: "Marked paid", badge: "bg-emerald-100 text-emerald-700" },
  "bill.mark_unpaid": { label: "Reverted to unpaid", badge: "bg-amber-100 text-amber-700" },
  "bill.gcash_confirm": { label: "Confirmed GCash", badge: "bg-emerald-100 text-emerald-700" },
  "bill.generate": { label: "Generated bills", badge: "bg-sky-100 text-sky-700" },
  "household.create": { label: "Added household", badge: "bg-sky-100 text-sky-700" },
  "resident.reset_password": { label: "Reset password", badge: "bg-amber-100 text-amber-700" },
  "alert.resolve": { label: "Resolved alert", badge: "bg-emerald-100 text-emerald-700" },
  "alert.unresolve": { label: "Reopened alert", badge: "bg-amber-100 text-amber-700" },
  "announcement.create": { label: "Posted announcement", badge: "bg-sky-100 text-sky-700" },
  "announcement.update": { label: "Edited announcement", badge: "bg-sky-100 text-sky-700" },
  "announcement.delete": { label: "Deleted announcement", badge: "bg-rose-100 text-rose-700" },
};

function auditActionMeta(action) {
  return AUDIT_ACTIONS[action] || { label: action, badge: "bg-slate-100 text-slate-600" };
}

function formatAuditTime(value) {
  if (!value) return "—";
  // SQLite datetime('now') is UTC, "YYYY-MM-DD HH:MM:SS" — mark as UTC then localize.
  const d = new Date(String(value).replace(" ", "T") + "Z");
  return isNaN(d) ? value : d.toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function AuditLogPage({ showToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("All");
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      setEntries(await fetchAuditLog(300));
    } catch (err) {
      showToast("Could not load audit log: " + err.message, "warn");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  const filtered = entries.filter((e) => {
    if (roleFilter !== "All" && (e.actorRole || "") !== roleFilter) return false;
    if (query) {
      const hay = `${e.actorEmail || ""} ${e.actorName || ""} ${e.details || ""} ${e.target || ""} ${auditActionMeta(e.action).label}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  });

  const selectCls =
    "border border-slate-300 rounded-lg px-2.5 py-1.5 text-[12px] bg-white text-slate-700 focus:outline-none focus:border-[#1e3a5f] focus:ring-1 focus:ring-[#1e3a5f]";

  return (
    <>
      <SectionHeader title="Audit Log" sub="Every staff action, with who did it and when" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search email, household, details…"
          className={`${selectCls} w-full sm:w-64`}
        />
        <select aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={selectCls}>
          <option value="All">All staff</option>
          <option value="officer">Water Officer</option>
          <option value="collector">Collector</option>
        </select>
        <button type="button" onClick={load} className="text-[12px] text-sky-600 hover:text-sky-800 font-medium px-1">
          Refresh
        </button>
        <span className="text-[11px] text-slate-400 ml-auto">{filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[12px] text-slate-400">Loading audit log…</div>
      ) : filtered.length === 0 ? (
        <div className="card-hover bg-white rounded-lg border border-slate-200 py-10 text-center text-[12px] text-slate-400">
          No matching activity yet.
        </div>
      ) : (
        <div className="card-hover bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-[12px] min-w-[720px]">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">When</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Staff</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Role</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Action</th>
                <th className="text-left px-3 py-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const meta = auditActionMeta(e.action);
                return (
                  <tr key={e.id} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{formatAuditTime(e.createdAt)}</td>
                    <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                      {e.actorName ? (
                        <>
                          <div className="font-medium">{e.actorName}</div>
                          <div className="text-[10px] text-slate-400">{e.actorEmail || "—"}</div>
                        </>
                      ) : (
                        e.actorEmail || "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${e.actorRole === "officer" ? "bg-indigo-100 text-indigo-700" : "bg-teal-100 text-teal-700"}`}>
                        {e.actorRole === "officer" ? "Officer" : e.actorRole === "collector" ? "Collector" : e.actorRole || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.badge}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{e.details || e.target || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
