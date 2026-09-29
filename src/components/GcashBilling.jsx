import React from "react";
import { peso } from "../data";

export function GcashBillingSection({ me, onPay, onCheckStatus, checking }) {
  const isPaid = me.paymentStatus === "Paid";
  const isGcashPending = me.paymentStatus === "GCash Pending";
  const isCashPending = me.paymentStatus === "Cash Pending";
  const displayAmount = isPaid ? 0 : me.totalDue;

  return (
    <>
      {isPaid && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 mb-4">
          <div className="font-semibold mb-1">Payment completed</div>
          <div>Your payment was received. Thank you for staying current.</div>
        </div>
      )}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-700">Pay your bill — {peso(displayAmount)}</div>
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            GCash secured by PayMongo
          </div>
        </div>
        <div className="p-4">
          {isGcashPending ? (
            <>
              <p className="text-[11px] text-slate-500 mb-3">
                Your GCash payment is being processed by PayMongo. If you already paid and this hasn't
                updated yet, check the status below.
              </p>
              <button
                onClick={onCheckStatus}
                disabled={checking}
                className="w-full flex items-center justify-center gap-2 font-semibold text-sm py-2.5 rounded-lg transition bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60"
              >
                {checking ? "Checking…" : "Check payment status"}
              </button>
            </>
          ) : isCashPending ? (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Marked <span className="font-semibold">Cash Pending</span>. Bring {peso(displayAmount)} to the
              barangay office — an admin will mark this Paid once they've received it.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 mb-3">
                {isPaid ? "No pending balance." : "Pay online with GCash, or in person with cash at the barangay office."}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => onPay(me.id)}
                  disabled={isPaid}
                  className={`flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-2.5 rounded-lg transition ${
                    isPaid
                      ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                      : "bg-[#0072CE] hover:bg-[#005ea3] text-white"
                  }`}
                >
                  <span className={`rounded px-1.5 py-0.5 text-xs font-extrabold ${isPaid ? "bg-slate-400 text-slate-500" : "bg-white text-[#0072CE]"}`}>G</span>
                  {isPaid ? "No payment due" : "Pay with GCash"}
                </button>
                <button
                  onClick={() => onPay(me.id, "cash")}
                  disabled={isPaid}
                  className={`flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-2.5 rounded-lg transition ${
                    isPaid
                      ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                  }`}
                >
                  <span className={`rounded px-1.5 py-0.5 text-xs font-extrabold ${isPaid ? "bg-slate-400 text-slate-500" : "bg-white text-emerald-600"}`}>₱</span>
                  {isPaid ? "No payment due" : "Pay with Cash"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
