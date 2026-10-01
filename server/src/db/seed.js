const bcrypt = require("bcryptjs");
const { db } = require("./database");

const RATE_PER_CM3 = 20;
const MIN_BILL = 200;

function computeBill(consumptionCm3) {
  return +Math.max(consumptionCm3 * RATE_PER_CM3, MIN_BILL).toFixed(2);
}

const seedHouseholds = [
  { id: "HH-001", name: "Juan dela Cruz", standpost: 25, meter: "158-SH-00013" },
  { id: "HH-002", name: "Maria Santos", standpost: 12, meter: "158-SH-00024" },
  { id: "HH-003", name: "Pedro Reyes", standpost: 7, meter: "158-SH-00031" },
  { id: "HH-004", name: "Luz Garcia", standpost: 18, meter: "158-SH-00008" },
  { id: "HH-005", name: "Jose Cruz", standpost: 33, meter: "158-SH-00019" },
  { id: "HH-006", name: "Ana Reyes", standpost: 4, meter: "158-SH-00042" },
  { id: "HH-007", name: "Carlos Bautista", standpost: 29, meter: "158-SH-00053" },
  { id: "HH-008", name: "Nena Flores", standpost: 11, meter: "158-SH-00063" },
];

function dateStamp(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Matches SQLite's own `datetime('now')` format ("YYYY-MM-DD HH:MM:SS", UTC).
// Using toISOString()'s "T...Z" format here instead would sort *after* rows
// inserted later at runtime via the column default, since "T" > " " in ASCII —
// breaking "ORDER BY recorded_at/created_at DESC" queries across seed + live data.
function sqliteNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

function seed() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM households").get();
  if (existing.n > 0) {
    console.log("Database already seeded — skipping. (Delete water_system.db to reseed.)");
    return;
  }

  console.log("Seeding database...");

  const insertHousehold = db.prepare(`
    INSERT INTO households (id, name, standpost, meter, address, date_connected)
    VALUES (@id, @name, @standpost, @meter, @address, @date_connected)
  `);

  const insertAccount = db.prepare(`
    INSERT INTO resident_accounts (household_id, password_hash)
    VALUES (@household_id, @password_hash)
  `);

  const insertBill = db.prepare(`
    INSERT INTO bills
      (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due, payment_status, payment_method, payment_ref, payment_date, due_date)
    VALUES
      (@household_id, @period, @prev_cm3, @curr_cm3, @amount, @prev_balance, @total_due, @payment_status, @payment_method, @payment_ref, @payment_date, @due_date)
  `);

  const insertReading = db.prepare(`
    INSERT INTO readings (household_id, cm3, flow_rate, flow_type, recorded_at, source)
    VALUES (@household_id, @cm3, @flow_rate, @flow_type, @recorded_at, 'mock')
  `);

  const insertAlert = db.prepare(`
    INSERT INTO alerts (id, household_id, type, flow_rate, threshold, status, created_at)
    VALUES (@id, @household_id, @type, @flow_rate, @threshold, @status, @created_at)
  `);

  const insertAdmin = db.prepare(`
    INSERT INTO admin_accounts (email, password_hash) VALUES (@email, @password_hash)
  `);

  const tx = db.transaction(() => {
    // Admin account: admin@barangay.local / admin12345
    insertAdmin.run({
      email: "admin@barangay.local",
      password_hash: bcrypt.hashSync("admin12345", 10),
    });

    const historyTemplate = [
      { period: "Jan 2026", prev: 20, curr: 28, amt: 200 },
      { period: "Feb 2026", prev: 28, curr: 44, amt: 320 },
      { period: "Mar 2026", prev: 44, curr: 50, amt: 200 },
      { period: "Apr 2026", prev: 50, curr: 53, amt: 200 },
    ];

    seedHouseholds.forEach((h, i) => {
      const purok = (h.standpost % 9) || 5;
      insertHousehold.run({
        id: h.id,
        name: h.name,
        standpost: h.standpost,
        meter: h.meter,
        address: `Purok ${purok} Kinamlutan, Butuan City`,
        date_connected: dateStamp(180 + i * 10),
      });

      // No password set yet — first login will create one (matches current frontend behavior)
      insertAccount.run({ household_id: h.id, password_hash: null });

      // Historical bills (all paid)
      historyTemplate.forEach((rec) => {
        insertBill.run({
          household_id: h.id,
          period: rec.period,
          prev_cm3: rec.prev,
          curr_cm3: rec.curr,
          amount: rec.amt,
          prev_balance: 0,
          total_due: rec.amt,
          payment_status: "Paid",
          payment_method: i % 2 === 0 ? "GCash" : "Offline",
          payment_ref: i % 2 === 0 ? `GC${10000000 + i}` : null,
          payment_date: dateStamp(60),
          due_date: null,
        });
      });

      // Current period (May 2026) — randomized like the original mock
      const prev = 10 + i * 4 + Math.floor(Math.random() * 6);
      const current = prev + 8 + Math.floor(Math.random() * 22);
      const consumption = current - prev;
      const amount = computeBill(consumption);
      const prevBalance = MIN_BILL === MIN_BILL ? 0 : 0; // first cycle has no carry-over
      const paymentStatus = Math.random() > 0.5 ? "Paid" : "Unpaid";
      const paymentMethod = paymentStatus === "Paid" ? (Math.random() > 0.5 ? "GCash" : "Offline") : null;

      insertBill.run({
        household_id: h.id,
        period: "May 2026",
        prev_cm3: prev,
        curr_cm3: current,
        amount,
        prev_balance: prevBalance,
        total_due: +(amount + prevBalance).toFixed(2),
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        payment_ref: paymentMethod === "GCash" ? `GC${20000000 + i}` : null,
        payment_date: paymentStatus === "Paid" ? dateStamp(2) : null,
        due_date: dateStamp(-10), // 10 days from now
      });

      // Latest sensor reading
      insertReading.run({
        household_id: h.id,
        cm3: current,
        flow_rate: 2 + Math.floor(Math.random() * 5),
        flow_type: "Normal",
        recorded_at: sqliteNow(),
      });
    });

    // A few sample alerts, same pattern as buildInitialAlerts()
    const alertTypes = ["Leak Detected", "High Flow", "No Sensor Data"];
    seedHouseholds.slice(0, 5).forEach((h, i) => {
      insertAlert.run({
        id: `ALT-${940 + i}`,
        household_id: h.id,
        type: alertTypes[i % alertTypes.length],
        flow_rate:
          alertTypes[i % alertTypes.length] === "No Sensor Data"
            ? "—"
            : `${(40 + Math.random() * 50).toFixed(0)} L/m`,
        threshold: "50 L/m",
        status: i < 2 ? "Unresolved" : "Resolved",
        created_at: sqliteNow(-i * 3600 * 1000),
      });
    });
  });

  tx();
  console.log(`Seeded ${seedHouseholds.length} households, admin account, bills, readings, and alerts.`);
  console.log("Admin login: admin@barangay.local / admin12345");
}

seed();