const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db/database");
const { authMiddleware, signToken } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");
const { fullName } = require("../utils/names");

const router = express.Router();

// Staff account management — lets an officer give each real staff member
// their own login instead of everyone sharing one set of credentials.
// Without this, the audit log (actor_email on every recorded action) can
// only ever say "admin@barangay.local" no matter who actually clicked the
// button, which makes it useless for tracing who edited a reading, deleted
// a payment, or changed a rate. One account per person fixes that: every
// audit row is then attributable to a specific staff member.

// GET /api/admin/accounts  (officer only) — list staff accounts. Never
// returns password_hash or reset-code fields.
router.get("/accounts", authMiddleware("admin", ["officer"]), (req, res) => {
  const rows = db
    .prepare("SELECT email, first_name, last_name, role, created_at FROM admin_accounts ORDER BY created_at")
    .all();
  res.json(
    rows.map((r) => ({
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      name: fullName(r),
      role: r.role,
      createdAt: r.created_at,
    }))
  );
});

// POST /api/admin/accounts  (officer only) — create a new staff account.
// Body: { email, password, role: "officer" | "collector", firstName, lastName }
router.post("/accounts", authMiddleware("admin", ["officer"]), (req, res) => {
  const { email, password, role, firstName, lastName } = req.body || {};

  if (!email || !String(email).includes("@")) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (role !== "officer" && role !== "collector") {
    return res.status(400).json({ error: "Role must be 'officer' or 'collector'." });
  }
  if (!firstName || !String(firstName).trim() || !lastName || !String(lastName).trim()) {
    return res.status(400).json({ error: "This account's first and last name are required — they're what show up in the audit log." });
  }

  const normalizedEmail = String(email).toLowerCase();
  const existing = db.prepare("SELECT email FROM admin_accounts WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const trimmedFirst = String(firstName).trim();
  const trimmedLast = String(lastName).trim();

  db.prepare("INSERT INTO admin_accounts (email, password_hash, role, first_name, last_name) VALUES (?, ?, ?, ?, ?)").run(
    normalizedEmail,
    bcrypt.hashSync(password, 10),
    role,
    trimmedFirst,
    trimmedLast
  );

  recordAudit(req, "admin.account_create", normalizedEmail, `Created a new ${role} account for ${trimmedFirst} ${trimmedLast} (${normalizedEmail})`);
  res.json({ success: true });
});

// PATCH /api/admin/me  (any signed-in admin) — self-service edit of your
// OWN account: first/last name, email (username), and password. Deliberately
// keyed off req.user.email (from the JWT), never a path param, so there's no
// way to edit anyone else's account through this endpoint. Changing the
// email or password requires re-entering the current password, same as any
// "change my credentials" flow — otherwise a hijacked, still-logged-in
// session could silently lock the real owner out.
// Body: { firstName?, lastName?, email?, currentPassword?, newPassword? }
router.patch("/me", authMiddleware("admin"), (req, res) => {
  const { firstName, lastName, email, currentPassword, newPassword } = req.body || {};

  const account = db.prepare("SELECT * FROM admin_accounts WHERE email = ?").get(req.user.email);
  if (!account) return res.status(404).json({ error: "Account not found." });

  const newEmail = email ? String(email).toLowerCase() : account.email;
  const emailChanging = newEmail !== account.email;
  const passwordChanging = Boolean(newPassword);

  if (emailChanging || passwordChanging) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
  }
  if (passwordChanging && newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  if (emailChanging) {
    if (!newEmail.includes("@")) return res.status(400).json({ error: "A valid email is required." });
    const existing = db.prepare("SELECT email FROM admin_accounts WHERE email = ?").get(newEmail);
    if (existing) return res.status(409).json({ error: "That email is already in use." });
  }

  const newFirstName = firstName !== undefined ? String(firstName).trim() : account.first_name;
  const newLastName = lastName !== undefined ? String(lastName).trim() : account.last_name;
  if (!newFirstName || !newLastName) {
    return res.status(400).json({ error: "First and last name are both required." });
  }
  const newPasswordHash = passwordChanging ? bcrypt.hashSync(newPassword, 10) : account.password_hash;

  db.prepare(
    "UPDATE admin_accounts SET email = ?, first_name = ?, last_name = ?, password_hash = ? WHERE email = ?"
  ).run(newEmail, newFirstName, newLastName, newPasswordHash, account.email);

  const name = fullName({ first_name: newFirstName, last_name: newLastName });
  const changedFields = [
    firstName !== undefined || lastName !== undefined ? "name" : null,
    emailChanging ? "email" : null,
    passwordChanging ? "password" : null,
  ].filter(Boolean);
  recordAudit(req, "admin.profile_update", newEmail, `${name} updated their own ${changedFields.join(", ") || "profile"}`);

  // Email/name may have just changed, so the old token's claims are stale —
  // issue a fresh one so the frontend can swap it in without forcing a
  // re-login mid-session.
  const token = signToken({ role: "admin", email: newEmail, staffRole: account.role, firstName: newFirstName, lastName: newLastName, name });
  res.json({ success: true, token, email: newEmail, firstName: newFirstName, lastName: newLastName, name, role: account.role });
});

// DELETE /api/admin/accounts/:email  (officer only) — remove a staff
// account, e.g. someone leaves or a shared/legacy login is being retired.
// Guarded so an officer can never lock everyone out: can't delete your own
// account, and can't delete the last remaining officer account.
router.delete("/accounts/:email", authMiddleware("admin", ["officer"]), (req, res) => {
  const targetEmail = String(req.params.email).toLowerCase();

  if (targetEmail === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: "You can't delete your own account while signed in to it." });
  }

  const target = db.prepare("SELECT * FROM admin_accounts WHERE email = ?").get(targetEmail);
  if (!target) return res.status(404).json({ error: "Account not found." });

  if (target.role === "officer") {
    const officerCount = db
      .prepare("SELECT COUNT(*) AS n FROM admin_accounts WHERE role = 'officer'")
      .get().n;
    if (officerCount <= 1) {
      return res.status(400).json({ error: "Can't delete the last remaining officer account." });
    }
  }

  db.prepare("DELETE FROM admin_accounts WHERE email = ?").run(targetEmail);
  recordAudit(req, "admin.account_delete", targetEmail, `Deleted the ${target.role} account for ${targetEmail}`);
  res.json({ success: true });
});

module.exports = router;
