import React from "react";
import { peso } from "../data";

export function GcashBillingSection({ me, onPay, onCheckStatus, checking }) {
  const isPaid = me.paymentStatus === "Paid";
  const isPending = me.paymentStatus === "GCash Pending";
  const displayAmount = isPaid ? 0 : me.totalDue;

  return (
    <>
      {isPaid && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 mb-4">
          <div className="font-semibold mb-1">Payment completed</div>
          <div>Your payment was received via GCash. Thank you for staying current.</div>
        </div>
      )}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-700">Pay your bill — {peso(displayAmount)}</div>
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Secured by PayMongo
          </div>
        </div>
        <div className="p-4">
          {isPending ? (
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
          ) : (
            <>
              <p className="text-[11px] text-slate-500 mb-3">
                {isPaid
                  ? "No pending balance."
                  : "You'll be taken to PayMongo's secure checkout page to complete your GCash payment."}
              </p>
              <button
                onClick={() => onPay(me.id)}
                disabled={isPaid}
                className={`w-full flex items-center justify-center gap-2 font-semibold text-sm py-2.5 rounded-lg transition ${
                  isPaid
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-[#0072CE] hover:bg-[#005ea3] text-white"
                }`}
              >
                <span className={`rounded px-1.5 py-0.5 text-xs font-extrabold ${isPaid ? "bg-slate-400 text-slate-500" : "bg-white text-[#0072CE]"}`}>G</span>
                {isPaid ? "No payment due" : `Pay ${peso(displayAmount)} with GCash`}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
