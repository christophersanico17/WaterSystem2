const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db/database");
const { signToken, authMiddleware } = require("../utils/auth");
const { verifyGoogleToken } = require("../utils/google");

const router = express.Router();

function isStrongPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

// POST /api/resident/login
// Body: { householdId, password, confirmPassword }
// First login for a household (no password_hash set yet) creates the
// password; returning residents authenticate against the stored hash.
router.post("/login", (req, res) => {
  const { householdId, password, confirmPassword, email, firstName, lastName } = req.body || {};

  if (!householdId || !password) {
    return res.json({ success: false, message: "Control number and password are required." });
  }

  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
  if (!household) {
    return res.json({ success: false, message: "We couldn't find an account with that control number." });
  }

  const account = db
    .prepare("SELECT * FROM resident_accounts WHERE household_id = ?")
    .get(householdId);
  const isNewPassword = !account || !account.password_hash;

  if (isNewPassword) {
    if (!isStrongPassword(password)) {
      return res.json({
        success: false,
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.",
      });
    }
    if (password !== confirmPassword) {
      return res.json({ success: false, message: "Passwords do not match." });
    }

    // Optional email + required first/last name captured at sign-up.
    const cleanEmail = typeof email === "string" ? email.trim() : "";
    const cleanFirstName = typeof firstName === "string" ? firstName.trim() : "";
    const cleanLastName = typeof lastName === "string" ? lastName.trim() : "";
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.json({ success: false, message: "Please enter a valid email address." });
    }
    if (!cleanFirstName || !cleanLastName) {
      return res.json({ success: false, message: "Please enter your first and last name." });
    }

    const hash = bcrypt.hashSync(password, 10);
    if (account) {
      db.prepare(
        "UPDATE resident_accounts SET password_hash = ?, updated_at = datetime('now') WHERE household_id = ?"
      ).run(hash, householdId);
    } else {
      db.prepare(
        "INSERT INTO resident_accounts (household_id, password_hash) VALUES (?, ?)"
      ).run(householdId, hash);
    }
    db.prepare("UPDATE households SET name = ? WHERE id = ?").run(`${cleanFirstName} ${cleanLastName}`, householdId);
    if (cleanEmail) {
      db.prepare("UPDATE households SET email = ? WHERE id = ?").run(cleanEmail, householdId);
    }
  } else {
    const matches = bcrypt.compareSync(password, account.password_hash);
    if (!matches) {
      return res.json({ success: false, message: "Incorrect password." });
    }
  }

  const token = signToken({ role: "resident", householdId });
  return res.json({ success: true, token, householdId });
});

// POST /api/resident/google-login
// Body: { householdId, credential }
// Verifies the Google ID token, then either links it to the household
// (first time) or signs in a household already linked to that Google account.
router.post("/google-login", async (req, res) => {
  const { householdId, credential } = req.body || {};

  if (!householdId) {
    return res.json({ success: false, message: "Select your household / standpost first." });
  }

  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
  if (!household) {
    return res.json({ success: false, message: "Unknown household / standpost." });
  }

  let profile;
  try {
    profile = await verifyGoogleToken(credential);
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }

  const linkedElsewhere = db
    .prepare("SELECT household_id FROM resident_accounts WHERE google_sub = ? AND household_id != ?")
    .get(profile.sub, householdId);
  if (linkedElsewhere) {
    return res.json({
      success: false,
      message: "This Google account is already linked to a different household.",
    });
  }

  const account = db
    .prepare("SELECT household_id FROM resident_accounts WHERE household_id = ?")
    .get(householdId);

  if (account) {
    db.prepare(
      `UPDATE resident_accounts
       SET google_sub = ?, google_email = ?, google_name = ?, google_picture = ?, updated_at = datetime('now')
       WHERE household_id = ?`
    ).run(profile.sub, profile.email, profile.name, profile.picture, householdId);
  } else {
    db.prepare(
      `INSERT INTO resident_accounts (household_id, google_sub, google_email, google_name, google_picture)
       VALUES (?, ?, ?, ?, ?)`
    ).run(householdId, profile.sub, profile.email, profile.name, profile.picture);
  }

  const token = signToken({ role: "resident", householdId });
  return res.json({ success: true, token, householdId, googleProfile: profile });
});

// GET /api/resident/google-status?householdId=HH-001
router.get("/google-status", (req, res) => {
  const { householdId } = req.query;
  if (!householdId) return res.status(400).json({ error: "householdId query param is required." });

  const account = db
    .prepare("SELECT google_email FROM resident_accounts WHERE household_id = ?")
    .get(householdId);

  res.json({ linked: Boolean(account && account.google_email), email: account ? account.google_email : null });
});

// POST /api/resident/google-unlink
// Requires a resident-scoped token; unlinks the caller's own household only.
router.post("/google-unlink", authMiddleware("resident"), (req, res) => {
  db.prepare(
    `UPDATE resident_accounts
     SET google_sub = NULL, google_email = NULL, google_name = NULL, google_picture = NULL, updated_at = datetime('now')
     WHERE household_id = ?`
  ).run(req.user.householdId);

  res.json({ success: true });
});

// POST /api/resident/forgot-password
// Body: { householdId }
// No verification code involved — this just files a request that an admin
// sees on the household's record and resolves by setting (and confirming)
// a new password directly.
router.post("/forgot-password", (req, res) => {
  const { householdId } = req.body || {};
  if (!householdId) {
    return res.json({ success: false, message: "Select your household / standpost first." });
  }

  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
  if (!household) {
    return res.json({ success: false, message: "Unknown household / standpost." });
  }

  const existing = db
    .prepare("SELECT id FROM password_reset_requests WHERE household_id = ? AND status = 'Pending'")
    .get(householdId);
  if (!existing) {
    db.prepare("INSERT INTO password_reset_requests (household_id) VALUES (?)").run(householdId);
  }

  return res.json({
    success: true,
    message: "Your request has been sent to the barangay water office. An admin will set your new password and let you know.",
  });
});

module.exports = router;
