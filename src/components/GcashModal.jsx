import React from "react";
import { Btn } from "../ui/atoms";
import { peso } from "../data";
import { BillReplica } from "./BillReplica";

export function GcashModal({ household, step, method = "gcash", receipt, onConfirm, onClose }) {
  if (!household) return null;
  const isCash = method === "cash";
  const wide = step === "success";
  const headerColor = isCash ? "bg-emerald-600" : "bg-[#0072CE]";
  const buttonColor = isCash ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#0072CE] hover:bg-[#005ea3]";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl ${wide ? "w-96" : "w-80"} overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <div className={`${headerColor} text-white px-5 py-4 flex items-center justify-between sticky top-0`}>
          <div className="flex items-center gap-2 font-bold">
            {isCash ? (
              <span className="bg-white text-emerald-600 rounded px-1.5 py-0.5 text-xs font-extrabold">₱</span>
            ) : (
              <span className="bg-white text-[#0072CE] rounded px-1.5 py-0.5 text-xs font-extrabold">G</span>
            )}
            {isCash ? "Cash Payment" : "GCash"}
          </div>
          {step !== "processing" && (
            <button onClick={onClose} className="text-white/80 hover:text-white text-lg leading-none">×</button>
          )}
        </div>

        <div className={step === "success" ? "p-4" : "p-6"}>
          {step === "confirm" && (
            <>
              <div className="text-xs text-slate-400 mb-1">Paying</div>
              <div className="font-bold text-slate-800 mb-4">Barangay Kinamlutan Water System</div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-500">Household</span>
                <span className="font-medium">{household.id}</span>
              </div>
              <div className="flex justify-between text-base mb-5">
                <span className="text-slate-500">Amount</span>
                <span className="font-bold text-lg">{peso(household.totalDue)}</span>
              </div>
              <button onClick={onConfirm} className={`w-full ${buttonColor} text-white font-semibold text-sm py-2.5 rounded-lg transition`}>
                {isCash ? "Confirm — I'll pay in cash" : "Continue to PayMongo checkout"}
              </button>
              <div className="text-[10px] text-slate-400 text-center mt-2">
                {isCash
                  ? "This marks your bill as pending cash payment. Bring the amount above to the barangay office — an admin will confirm it once received."
                  : "You'll be redirected to PayMongo's secure page to complete your GCash payment."}
              </div>
            </>
          )}

          {step === "processing" && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className={`w-8 h-8 border-[3px] ${isCash ? "border-emerald-600" : "border-[#0072CE]"} border-t-transparent rounded-full animate-spin`} />
              <div className="text-sm text-slate-500">{isCash ? "Recording your cash payment intent…" : "Redirecting to PayMongo…"}</div>
            </div>
          )}

          {step === "cash-pending" && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="flex flex-col items-center gap-1 pt-1">
                <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 text-xl">⏳</div>
                <div className="font-bold text-slate-800 text-sm">Cash payment pending</div>
              </div>
              <p className="text-[12px] text-slate-500 text-center">
                Your bill is now marked <span className="font-semibold text-amber-600">Cash Pending</span>. Bring{" "}
                <span className="font-semibold">{peso(household.totalDue)}</span> to the barangay office — it'll be
                marked Paid once an admin confirms they've received it.
              </p>
              <button onClick={onClose} className="mt-1 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-2.5 rounded-lg transition">
                Done
              </button>
            </div>
          )}

          {step === "success" && receipt && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-col items-center gap-1 pt-1">
                <div className="w-11 h-11 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-500 text-xl">✓</div>
                <div className="font-bold text-slate-800 text-sm">Payment successful</div>
              </div>

              <div className="w-full print-area">
                <BillReplica me={household} paymentStamp={receipt} />
              </div>

              <div className="flex gap-2 w-full no-print">
                <Btn className="flex-1" onClick={() => window.print()}>Print receipt</Btn>
                <Btn className="flex-1" onClick={() => window.print()}>Download as PDF</Btn>
              </div>
              <button onClick={onClose} className="mt-1 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-2.5 rounded-lg transition no-print">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
