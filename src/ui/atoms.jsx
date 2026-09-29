import React from "react";

export function Badge({ tone = "neutral", children }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-600",
    good: "bg-emerald-50 text-emerald-700",
    bad: "bg-rose-50 text-rose-700",
    warn: "bg-amber-50 text-amber-700",
    info: "bg-sky-50 text-sky-700",
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, tone = "default", accent }) {
  const toneClasses = {
    default: "text-slate-900",
    good: "text-emerald-600",
    bad: "text-rose-600",
    warn: "text-amber-600",
  };

  return (
    <div className={`card-hover bg-white rounded-lg border ${accent ? `border-t-2 ${accent}` : "border-slate-200"} px-4 py-3 flex-1 min-w-[130px]`}>
      <div className="text-[11px] text-slate-500 font-medium">{label}</div>
      <div className={`text-xl font-bold mt-1 ${toneClasses[tone]}`}>{value}</div>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;

  const tones = { success: "bg-emerald-600", info: "bg-slate-800", warn: "bg-amber-600" };

  return (
    <div className={`fixed bottom-6 right-6 ${tones[toast.tone || "info"]} text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg z-50 max-w-xs`}>
      {toast.message}
    </div>
  );
}

export function Btn({ children, onClick, variant = "outline", tone = "default", className = "", type = "button", disabled = false }) {
  const variants = {
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50",
    primary: "bg-[#1e3a5f] text-white hover:bg-[#16304f]",
    secondary: "bg-sky-600 text-white hover:bg-sky-700",
    ghost: "text-sky-700 hover:underline",
    ghostMuted: "text-slate-500 hover:text-slate-700 hover:underline",
  };

  const toneOverrides = {
    good: "text-emerald-700 hover:text-emerald-800 hover:underline",
  };

  const baseClass = variants[variant];
  const toneClass = tone !== "default" && toneOverrides[tone] ? toneOverrides[tone] : "";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`text-[13px] font-semibold px-3 py-1.5 rounded-md transition ${baseClass} ${toneClass} ${
        disabled ? "opacity-60 cursor-not-allowed" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}
