import React from "react";
import { peso } from "../data";

export function GcashBillingSection({ me, onPay }) {
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
          <div className="text-[10px] text-slate-400">GCash QR</div>
        </div>
        <div className="p-4">
          {isGcashPending ? (
            <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg p-3">
              Reference <span className="font-semibold">{me.paymentReference || "submitted"}</span> is waiting for admin verification.
            </p>
          ) : isCashPending ? (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Marked <span className="font-semibold">Cash Pending</span>. Bring {peso(displayAmount)} to the
              barangay office — an admin will mark this Paid once they've received it.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 mb-3">
                {isPaid ? "No pending balance." : "Scan the GCash QR code to pay. An admin will verify your receipt reference."}
              </p>
              <button
                onClick={() => onPay(me.id)}
                disabled={isPaid}
                className={`w-full flex items-center justify-center gap-2 font-semibold text-sm py-2.5 rounded-lg transition ${
                  isPaid ? "bg-slate-300 text-slate-500 cursor-not-allowed" : "bg-[#0072CE] hover:bg-[#005ea3] text-white"
                }`}
              >
                {isPaid ? "No payment due" : "Pay with GCash QR"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
