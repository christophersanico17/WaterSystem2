export const seedHouseholds = [
  { id: "HH-001", name: "Juan dela Cruz", email: "juan.delacruz@gmail.com", standpost: 25, meter: "158-SH-00013" },
  { id: "HH-002", name: "Maria Santos", email: "maria.santos@gmail.com", standpost: 12, meter: "158-SH-00024" },
  { id: "HH-003", name: "Pedro Reyes", email: "pedro.reyes@gmail.com", standpost: 7, meter: "158-SH-00031" },
  { id: "HH-004", name: "Luz Garcia", email: "luz.garcia@gmail.com", standpost: 18, meter: "158-SH-00008" },
  { id: "HH-005", name: "Jose Cruz", email: "jose.cruz@gmail.com", standpost: 33, meter: "158-SH-00019" },
  { id: "HH-006", name: "Ana Reyes", email: "ana.reyes@gmail.com", standpost: 4, meter: "158-SH-00042" },
  { id: "HH-007", name: "Carlos Bautista", email: "carlos.bautista@gmail.com", standpost: 29, meter: "158-SH-00053" },
  { id: "HH-008", name: "Nena Flores", email: "nena.flores@gmail.com", standpost: 11, meter: "158-SH-00063" },
];

export const RATE_PER_CM3 = 20;
export const MIN_BILL = 200;
export const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function currentBillingPeriod(date = new Date()) {
  return `${MONTH_SHORT_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export const BILLING_PERIOD = `Month of ${currentBillingPeriod()}`;

function previousBillingPeriods(count, date = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const previousDate = new Date(date.getFullYear(), date.getMonth() - count + index, 1);
    return currentBillingPeriod(previousDate);
  });
}

// Dates are handled as plain "YYYY-MM-DD" strings throughout (no time/zone
// component). Parsing "YYYY-MM-DD" via `new Date(str)` treats it as UTC
// midnight, which can shift the displayed calendar day by one in timezones
// behind UTC — so we parse the components manually and build a local Date.
export function formatDueDate(isoDate) {
  if (!isoDate) return "—";
  const [year, month, day] = String(isoDate).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function dueDateForPeriod(period = currentBillingPeriod()) {
  const [month, year] = period.split(" ");
  const monthIndex = MONTH_SHORT_NAMES.indexOf(month);
  let dueMonth = monthIndex + 1;
  let dueYear = Number(year);
  if (dueMonth > 11) {
    dueMonth = 0;
    dueYear += 1;
  }
  return `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}-09`;
}

export function billingDateForPeriod(period = currentBillingPeriod()) {
  const [month, year] = period.split(" ");
  const monthIndex = MONTH_SHORT_NAMES.indexOf(month);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-25`;
}

// How many whole days a bill is past its due date. Returns 0 for paid bills,
// missing due dates, or bills not yet due. Dates are compared at local midnight
// so a bill due "today" is not counted as overdue.
export function daysOverdue(dueDate, paymentStatus) {
  if (paymentStatus === "Paid" || !dueDate) return 0;
  const [y, m, d] = String(dueDate).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - due) / 86400000);
  return diff > 0 ? diff : 0;
}

// A household's current bill is overdue when it isn't paid and its due date has
// passed. (Display-only — no penalties are applied.)
export function isOverdue(household) {
  return household ? daysOverdue(household.dueDate, household.paymentStatus) > 0 : false;
}

export function peso(n) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function computeBill(consumptionCm3) {
  return +Math.max(consumptionCm3 * RATE_PER_CM3, MIN_BILL).toFixed(2);
}

export function getConsumptionStatus(me) {
  const pastUsages = me.history.slice(0, -1).map((r) => r.curr - r.prev);
  if (pastUsages.length === 0) {
    return {
      level: "normal",
      label: "Normal usage",
      message: `Your usage this cycle is ${me.consumption} CM³. We'll start comparing this against your average once more billing history is available.`,
      tone: "good",
    };
  }
  const avg = pastUsages.reduce((s, v) => s + v, 0) / pastUsages.length;
  const ratio = me.consumption / avg;

  if (ratio >= 1.6) {
    return {
      level: "high",
      label: "High usage",
      message: `Your usage this cycle (${me.consumption} CM³) is well above your average of ${avg.toFixed(0)} CM³. This could indicate a leak — please check your pipes and faucets.`,
      tone: "bad",
    };
  }

  if (ratio >= 1.25) {
    return {
      level: "elevated",
      label: "Above normal",
      message: `Your usage this cycle (${me.consumption} CM³) is higher than your usual average of ${avg.toFixed(0)} CM³. Keep an eye on it over the next few days.`,
      tone: "warn",
    };
  }

  return {
    level: "normal",
    label: "Normal usage",
    message: `Your usage this cycle (${me.consumption} CM³) is within your normal range (avg. ${avg.toFixed(0)} CM³).`,
    tone: "good",
  };
}

export function genReading(prevCm3, anomalyChance = 0.12) {
  const isAnomaly = Math.random() < anomalyChance;
  const normalDelta = 8 + Math.floor(Math.random() * 22);
  const anomalyDelta = 55 + Math.floor(Math.random() * 40);
  const delta = isAnomaly ? anomalyDelta : normalDelta;
  return { current: prevCm3 + delta, isAnomaly, delta };
}

export function dateStamp() {
  return new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function buildInitialHouseholds() {
  return seedHouseholds.map((h, i) => {
    const prev = 10 + i * 4 + Math.floor(Math.random() * 6);
    const current = prev + 8 + Math.floor(Math.random() * 22);
    const consumption = current - prev;
    const amount = computeBill(consumption);
    const prevBalance = MIN_BILL;

    const paymentStatus = Math.random() > 0.5 ? "Paid" : "Unpaid";
    const paymentMethod = paymentStatus === "Paid" ? (Math.random() > 0.5 ? "GCash" : "Offline") : undefined;
    const paymentStamp = paymentMethod === "GCash" ? {
      ref: `GC${Math.floor(10000000 + Math.random() * 90000000)}`,
      date: dateStamp(),
      method: "GCash",
    } : undefined;

    const period = currentBillingPeriod();
    const historyPeriods = previousBillingPeriods(4);
    const dueDate = dueDateForPeriod(period);
    const billingDate = billingDateForPeriod(period);
    return {
      ...h,
      period,
      dateConnected: "2024-12-10",
      prevCm3: prev,
      currCm3: current,
      totalConsumed: prev + current,
      consumption,
      amount,
      prevBalance,
      totalDue: +(amount + prevBalance).toFixed(2),
      dueDate,
      billingDate,
      paymentStatus,
      paymentMethod,
      paymentStamp,
      lastFlow: 2 + Math.floor(Math.random() * 5),
      flowType: "Normal",
      history: [
        { period: historyPeriods[0], prev: 20, curr: 28, amt: 200, paid: true },
        { period: historyPeriods[1], prev: 28, curr: 44, amt: 320, paid: true },
        { period: historyPeriods[2], prev: 44, curr: 50, amt: 200, paid: true },
        { period: historyPeriods[3], prev: 50, curr: 53, amt: 200, paid: true },
        { period, prev, curr: current, amt: amount, paid: paymentStatus === "Paid" },
      ],
    };
  });
}

export function buildInitialAlerts(households) {
  const types = ["Leak Detected", "High Flow", "No Sensor Data"];
  return households.slice(0, 5).map((h, i) => ({
    id: `ALT-${940 + i}`,
    householdId: h.id,
    name: h.name,
    standpost: h.standpost,
    type: types[i % types.length],
    flowRate: types[i % types.length] === "No Sensor Data" ? "—" : `${(40 + Math.random() * 50).toFixed(0)} L/m`,
    threshold: "50 L/m",
    time: i === 0 ? "Just now" : `${dateStamp()}`,
    status: i < 2 ? "Unresolved" : "Resolved",
  }));
}
