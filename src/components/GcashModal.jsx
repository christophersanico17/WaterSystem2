import React from "react";
import { peso } from "../data";
import gcashQrImage from "../assets/gcash-qr.jpg";

export function GcashModal({ household, step, onConfirm, onClose }) {
  const [paymentReference, setPaymentReference] = React.useState("");
  if (!household) return null;

  function submitReference(event) {
    event.preventDefault();
    onConfirm(paymentReference.trim());
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[min(100%,26rem)] overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-[#0072CE] text-white px-5 py-4 flex items-center justify-between sticky top-0">
          <div className="font-bold">Pay with GCash QR</div>
          {step !== "processing" && (
            <button onClick={onClose} aria-label="Close" className="text-white/80 hover:text-white text-lg leading-none">×</button>
          )}
        </div>

        <div className="p-5">
          {step === "confirm" && (
            <form onSubmit={submitReference} className="flex flex-col items-center">
              <div className="text-xs text-slate-500">Barangay Kinamlutan Water System</div>
              <div className="text-lg font-bold text-slate-800 mt-1">{peso(household.totalDue)}</div>
              <img
                src={gcashQrImage}
                alt="GCash payment QR code"
                className="w-56 h-56 object-contain border border-slate-200 rounded-md my-4"
              />
              <div className="w-full text-xs text-slate-600 mb-3">
                Scan the QR code and pay the exact amount above. Enter the payment reference shown on your receipt.
              </div>
              <label htmlFor="gcash-payment-reference" className="w-full text-xs font-semibold text-slate-600 mb-1">
                GCash reference number
              </label>
              <input
                id="gcash-payment-reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={80}
                required
                autoComplete="off"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter receipt reference"
              />
              <button
                type="submit"
                disabled={!paymentReference.trim()}
                className="w-full mt-3 bg-[#0072CE] hover:bg-[#005ea3] text-white font-semibold text-sm py-2.5 rounded-md transition disabled:opacity-50"
              >
                Submit reference for verification
              </button>
            </form>
          )}

          {step === "processing" && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-[#0072CE] border-t-transparent rounded-full animate-spin" />
              <div className="text-sm text-slate-500">Submitting payment reference…</div>
            </div>
          )}

          {step === "gcash-pending" && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 text-xl">⏳</div>
              <div className="font-bold text-slate-800 text-sm">Waiting for admin verification</div>
              <p className="text-xs text-slate-500">
                Your GCash reference <span className="font-semibold text-slate-700">{household.paymentReference || paymentReference}</span> was submitted. Your bill will update after an admin verifies the payment.
              </p>
              <button onClick={onClose} className="mt-1 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-2.5 rounded-md transition">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
