process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { db } = require("../src/db/database");
const { signToken } = require("../src/utils/auth");
const dataRoutes = require("../src/routes/data");

const app = express();
app.use(express.json());
app.use(dataRoutes);

test("resident submits a GCash QR reference for admin verification", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-QR-1", "QR Test Resident", 1, "M-QR-1");
  const billId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, total_due)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("HH-QR-1", "Oct 2026", 0, 10, 200, 200).lastInsertRowid;

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const residentToken = signToken({ role: "resident", householdId: "HH-QR-1" });

  const invalidReferenceResponse = await fetch(`http://127.0.0.1:${port}/bills/${billId}/gcash/reference`, {
    method: "POST",
    headers: { Authorization: `Bearer ${residentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reference: "GC12345678" }),
  });
  assert.equal(invalidReferenceResponse.status, 400);

  const submitResponse = await fetch(`http://127.0.0.1:${port}/bills/${billId}/gcash/reference`, {
    method: "POST",
    headers: { Authorization: `Bearer ${residentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reference: "  12345678  " }),
  });
  assert.equal(submitResponse.status, 200);
  assert.deepEqual(await submitResponse.json(), { success: true, status: "GCash Pending" });
  assert.deepEqual(
    db.prepare("SELECT payment_status, payment_ref FROM bills WHERE id = ?").get(billId),
    { payment_status: "GCash Pending", payment_ref: "QR:12345678" }
  );

  const syncResponse = await fetch(`http://127.0.0.1:${port}/bills/${billId}/gcash/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${residentToken}` },
  });
  assert.deepEqual(await syncResponse.json(), { success: true, paid: false, status: "GCash Pending" });

  const adminToken = signToken({ role: "admin", email: "admin@example.test" });
  const mismatchResponse = await fetch(`http://127.0.0.1:${port}/bills/${billId}/gcash/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reference: "00000000" }),
  });
  assert.equal(mismatchResponse.status, 400);
  assert.equal(db.prepare("SELECT payment_status FROM bills WHERE id = ?").get(billId).payment_status, "GCash Pending");

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/bills/${billId}/gcash/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reference: " 12345678 " }),
  });
  assert.equal(confirmResponse.status, 200);
  assert.equal(db.prepare("SELECT payment_status FROM bills WHERE id = ?").get(billId).payment_status, "Paid");

  const manualBillId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, total_due)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("HH-QR-1", "Sep 2026", 0, 10, 200, 200).lastInsertRowid;
  const missingManualReference = await fetch(`http://127.0.0.1:${port}/bills/${manualBillId}/mark-paid`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GCash", amount: 200 }),
  });
  assert.equal(missingManualReference.status, 400);

  const manualPaidResponse = await fetch(`http://127.0.0.1:${port}/bills/${manualBillId}/mark-paid`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GCash", amount: 200, reference: "87654321" }),
  });
  assert.equal(manualPaidResponse.status, 200);
  assert.deepEqual(
    db.prepare("SELECT payment_status, payment_method, payment_ref FROM bills WHERE id = ?").get(manualBillId),
    { payment_status: "Paid", payment_method: "GCash", payment_ref: "QR:87654321" }
  );
});