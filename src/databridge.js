// Converts raw API response shapes (residents, bills, readings) into the
// single "household" object shape that every resident/admin component in
// this app already expects (prevCm3, currCm3, totalDue, history, etc.)
// This keeps all existing UI components unchanged when USE_API is true.

import { dueDateForPeriod, billingDateForPeriod } from "./data";

const RATE_PER_CM3 = 20;
const MIN_BILL = 200;

function peso(n) {
  return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeBill(consumptionCm3) {
  return +Math.max(consumptionCm3 * RATE_PER_CM3, MIN_BILL).toFixed(2);
}

/**
 * @param {object} resident - one row from GET /api/residents
 * @param {object|null} latestBill - the most recent bill row for this resident
 * @param {object|null} reading - the latest sensor reading row (or null)
 * @param {object[]} allBills - every bill row for this resident, oldest→newest
 */
export function residentToHousehold(resident, latestBill, reading, allBills = []) {
  const sortedBills = [...allBills].sort((a, b) => a.id - b.id);

  const history = sortedBills.map((b) => ({
    period: b.period,
    prev: b.prev_cm3,
    curr: b.curr_cm3,
    amt: b.amount,
    paid: b.payment_status === "Paid",
    method: b.payment_method,
  }));

  const prevCm3 = reading ? null : latestBill ? latestBill.prev_cm3 : 0;
  const currCm3 = reading ? reading.cm3 : latestBill ? latestBill.curr_cm3 : 0;
  const baselinePrev = latestBill ? latestBill.prev_cm3 : 0;
  const consumption = latestBill ? latestBill.curr_cm3 - latestBill.prev_cm3 : 0;
  const amount = latestBill ? latestBill.amount : computeBill(0);
  const prevBalance = latestBill ? latestBill.prev_balance : 0;
  const totalDue = latestBill ? latestBill.total_due : amount;

  const paymentStatus = latestBill ? latestBill.payment_status : "Unpaid";
  const paymentMethod = latestBill ? latestBill.payment_method : null;
  const paymentStamp =
    latestBill && latestBill.payment_method === "GCash"
      ? {
          ref: latestBill.payment_ref,
          date: latestBill.payment_date,
          method: "GCash",
        }
      : undefined;

  const period = latestBill ? latestBill.period : "May 2026";
  const dueDate = latestBill && latestBill.due_date ? latestBill.due_date : dueDateForPeriod(period);
  const billingDate = billingDateForPeriod(period);

  return {
    id: resident.resident_id,
    name: resident.name,
    standpost: resident.standpost,
    meter: resident.meter_no,
    address: resident.address,
    phone: resident.phone || null,
    email: resident.email || null,
    dateConnected: resident.date_connected,
    password: resident.has_password ? "••••••••" : null, // presence flag only; never store real password client-side
    googleLinked: Boolean(resident.google_email),
    googleEmail: resident.google_email || null,

    period,
    dueDate,
    billingDate,

    prevCm3: baselinePrev,
    currCm3: reading ? reading.cm3 : currCm3,
    consumption,
    amount,
    prevBalance,
    totalDue,

    paymentStatus,
    paymentMethod,
    paymentStamp,

    lastFlow: reading ? reading.flow_rate : 0,
    flowType: reading ? reading.flow_type : "Normal",
    lastReadingAt: reading ? reading.recorded_at : null,

    // IoT device (Arduino/ESP + flow sensor) status — non-secret fields from
    // GET /api/residents; the device key itself is only ever fetched/shown
    // via the admin-only device endpoints (src/api.js fetchDeviceStatus etc).
    deviceProvisioned: Boolean(resident.device_provisioned),
    deviceLastSeen: resident.device_last_seen || null,
    pulsesPerLiter: resident.pulses_per_liter || 450,
    passwordResetRequested: Boolean(resident.password_reset_requested),

    bill_id: latestBill ? latestBill.id : null,
    history: history.length > 0 ? history : [{ period: "May 2026", prev: 0, curr: 0, amt: MIN_BILL }],
  };
}

export { peso, computeBill };