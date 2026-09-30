import React from "react";
import { peso, formatDueDate, dueDateForPeriod, billingDateForPeriod } from "../data";

// Shared bill statement layout — used by the resident's "My Bills" page, the
// admin's Bill Statements page, and the GCash payment receipt, so all three
// always render the exact same document.
//
// `period` (optional) selects which billing cycle this statement is a snapshot
// of — previous/current consumption, amount, balance and paid status are all
// read from *that* cycle's own history record, not always the latest one.
// Pass it when the caller has a billing-period selector (e.g. My Bills); omit
// it elsewhere and it defaults to the most recent period.
export function BillReplica({ me, paymentStamp, period }) {
  const latestIdx = me.history.length - 1;
  const matchedIdx = period ? me.history.findIndex((h) => h.period === period.label) : -1;
  const idx = matchedIdx === -1 ? latestIdx : matchedIdx;

  const currentConsumed = me.history[idx];
  const prevRec = me.history[idx - 1] || currentConsumed;
  const prevConsumed = +(prevRec.curr - prevRec.prev).toFixed(0);
  const currentCM2 = currentConsumed.curr - currentConsumed.prev;
  const currentAmt = currentConsumed.amt;

  // Only cycles *before* the one being viewed, and still unpaid as of now,
  // count toward the balance shown on that statement — a paid cycle's own
  // receipt shouldn't list other paid cycles as outstanding.
  const balanceRows = me.history
    .slice(0, idx)
    .filter((rec) => !rec.paid)
    .map((rec) => ({
      consumed: rec.curr - rec.prev,
      month: rec.period.split(" ")[0].toUpperCase(),
      amount: rec.amt,
    }));

  const totalAmount = [...balanceRows.map((r) => r.amount), currentAmt].reduce((s, v) => s + v, 0);

  const selectedPeriod = period || { label: currentConsumed.period };

  const isPaid = paymentStamp ? true : currentConsumed.paid ?? me.paymentStatus === "Paid";
  const paymentMethod = paymentStamp?.method || currentConsumed.method || me.paymentMethod;

  return (
    <div
      className="bill-replica bg-white border border-slate-300 rounded-lg overflow-hidden text-[12px] mx-auto"
      style={{ width: "100%", maxWidth: "640px" }}
    >
      {/* Title */}
      <div className="text-center px-6 py-4 bg-sky-100 border-b-2 border-slate-400">
        <div className="font-extrabold text-slate-800 text-[15px] tracking-wide">
          BARANGAY KINAMLUTAN WATER SYSTEM
        </div>
      </div>

      {/* Contact bar */}
      <div className="bg-slate-50 px-5 py-2 flex items-center justify-between text-[11px] border-b border-slate-200 flex-wrap gap-2">
        <div>
          <div className="font-semibold text-slate-700">KINAMLUTAN, BUTUAN CITY</div>
          <div className="text-slate-500">ZIP CODE: 8600</div>
        </div>
        <div className="flex items-center gap-4 text-slate-600 flex-wrap">
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 text-[#1e3a5f]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
            (963) 960-4962
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 text-[#1e3a5f]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
            barangaykinamlutan@gmail.com
          </span>
        </div>
      </div>

      {/* Bill to + billing info */}
      <div className="px-5 py-4 grid grid-cols-2 gap-4 border-b border-slate-200">
        <div className="space-y-1.5">
          <div className="flex gap-2 items-center">
            <span className="font-bold text-slate-700 w-16 flex-shrink-0 bg-yellow-200 px-1.5 py-0.5 rounded text-[10px] uppercase">Bill To</span>
            <span className="font-bold text-slate-800 uppercase">{me.name}</span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="font-bold text-slate-700 w-16 flex-shrink-0 bg-yellow-200 px-1.5 py-0.5 rounded text-[10px] uppercase">Address</span>
            <span className="text-slate-700">
              Purok {me.standpost % 9 || 5} Kinamlutan, Butuan City
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="bg-sky-100 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-700 uppercase">Standpost #</span>
            <span className="font-semibold text-slate-700">{me.standpost}</span>
          </div>
          <div>
            <span className="text-slate-500">Billing #:</span>
            <span className="ml-1 font-semibold text-slate-700">
              02-24-{String(me.standpost).padStart(5, "0")}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="bg-sky-100 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-700 uppercase">Meter #</span>
            <span className="font-semibold text-slate-700">{me.meter}</span>
          </div>
          <div>
            <span className="text-slate-500">Billing Date:</span>
            <span className="ml-1 font-semibold text-slate-700">
              {formatDueDate(billingDateForPeriod(selectedPeriod.label))}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Date of Connection:</span>
            <span className="ml-1 font-semibold text-slate-700">
              {formatDueDate(me.dateConnected)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Due Date:</span>
            <span className="ml-1 font-bold text-rose-600">
              {formatDueDate(dueDateForPeriod(selectedPeriod.label))}
            </span>
          </div>
        </div>
      </div>

      {/* Billing tables */}
      <div className="px-5 py-4 grid grid-cols-2 gap-4 border-b border-slate-200">
        {/* Left: Previous billing */}
        <div>
          <table className="w-full text-[11px] border border-slate-300">
            <thead>
              <tr className="bg-slate-100">
                <th className="text-center font-semibold text-slate-700 px-2 py-1.5 border-b border-slate-300 border-r border-slate-300">
                  BILLING FOR:
                </th>
                <th className="text-center font-semibold text-slate-700 px-2 py-1.5 border-b border-slate-300">
                  MONTH OF {selectedPeriod.label.split(" ")[0].toUpperCase()}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-2 py-2 text-center text-slate-600 border-r border-slate-300 leading-tight text-[10px]">
                  PREVIOUS
                  <br />
                  CONSUMED CM2
                  <br />
                  (MONTH OF {prevRec.period.split(" ")[0].toUpperCase()})
                </td>
                <td className="px-2 py-2 text-center text-slate-600 leading-tight text-[10px]">
                  PREVIOUS BILLING AMOUNT
                </td>
              </tr>
              <tr className="border-t border-slate-300">
                <td className="px-2 py-2 text-center font-bold text-slate-800 border-r border-slate-300">
                  {prevConsumed}
                </td>
                <td className="px-2 py-2 text-center font-bold text-slate-800">
                  {peso(prevRec.amt)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-[10px] text-emerald-800">
            <div>₱20.00 Per CM2</div>
            <div>CC CM2= TCCM2-PC CM2</div>
          </div>
        </div>

        {/* Right: Current billing + balance */}
        <div>
          <table className="w-full text-[11px] border border-slate-300">
            <thead>
              <tr className="bg-yellow-200">
                <th
                  colSpan={3}
                  className="text-center font-bold text-amber-800 px-2 py-1.5 border-b border-slate-300"
                >
                  CURRENT BILLING
                </th>
              </tr>
              <tr className="bg-amber-50 border-b border-slate-300">
                <th className="text-center font-semibold text-slate-600 px-2 py-1 text-[10px]">
                  TOTAL
                  <br />
                  CONSUMED
                </th>
                <th className="text-center font-semibold text-slate-600 px-2 py-1 border-l border-slate-300 text-[10px]">
                  CURRENT
                  <br />
                  CONSUMED CM2
                  <br />({selectedPeriod.label.split(" ")[0].toUpperCase()})
                </th>
                <th className="text-center font-semibold text-slate-600 px-2 py-1 border-l border-slate-300 text-[10px]">
                  TOTAL AMOUNT
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="px-2 py-2 text-center font-bold text-slate-800">
                  {currentConsumed.curr}
                </td>
                <td className="px-2 py-2 text-center font-bold text-slate-800 border-l border-slate-300">
                  {currentCM2}
                </td>
                <td className="px-2 py-2 text-center font-bold text-slate-800 border-l border-slate-300">
                  {peso(currentAmt)}
                </td>
              </tr>
              <tr className="bg-yellow-100 border-t border-slate-300">
                <td
                  colSpan={3}
                  className="px-2 py-1 font-semibold text-slate-700 text-[11px]"
                >
                  BALANCE
                </td>
              </tr>
              {balanceRows.map((row) => (
                <tr key={row.month} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-center text-slate-600">{row.consumed}</td>
                  <td className="px-2 py-1 text-center text-slate-600 border-l border-slate-200">
                    {row.month}
                  </td>
                  <td className="px-2 py-1 text-right text-slate-700 border-l border-slate-200 pr-3">
                    {peso(row.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-400 bg-yellow-100">
                <td colSpan={2} className="px-2 py-2 font-bold text-slate-800 text-[11px]">
                  TOTAL AMOUNT
                </td>
                <td className="px-2 py-2 text-right font-bold text-slate-800 pr-3">
                  {peso(totalAmount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Minimum billing note */}
      <div className="px-5 py-2 text-[10px] text-slate-500 border-b border-slate-100 italic">
        As per terms and condition the minimum billing is ₱200.00.
      </div>

      {/* Signatures */}
      <div className="px-5 py-4 flex justify-between text-[11px] text-slate-600">
        <div>
          <div>Prepared By:</div>
          <div className="h-8" aria-hidden="true" />
          <div className="font-bold text-slate-800">
            MERY ANN S. BOTOY
          </div>
          <div className="text-slate-500">CLERK II</div>
        </div>
        <div className="text-right">
          <div>Checked and Approved by:</div>
          <div className="h-8" aria-hidden="true" />
          <div className="font-bold text-slate-800 text-right">
            HON. NATIVIDAD E. ELAGOR
          </div>
          <div className="text-slate-500">PUNONG BARANGAY</div>
        </div>
      </div>

      {/* Payment status footer */}
      <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <span className="text-[10px] text-slate-500">Payment status</span>
        <div className="flex gap-2 items-center">
          {isPaid ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
              Paid
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[11px] font-semibold">
              Unpaid
            </span>
          )}
          {isPaid && paymentMethod && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                paymentMethod === "GCash" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-700"
              }`}
            >
              {paymentMethod === "GCash" ? "Paid via GCash" : "Cash payment"}
            </span>
          )}
        </div>
      </div>

      {/* Payment receipt (only present right after a fresh payment confirmation) */}
      {paymentStamp && (
        <div className="px-5 py-2.5 bg-emerald-50 border-t border-emerald-200 text-[10px] text-emerald-800">
          <div className="font-bold">PAYMENT RECEIPT</div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div>
              <span className="font-semibold">Payment Method:</span> {paymentStamp.method}
            </div>
            <div className="text-right">
              <span className="font-semibold">Date:</span> {paymentStamp.date}
            </div>
            <div className="col-span-2">
              <span className="font-semibold">Reference No:</span> {paymentStamp.ref}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
