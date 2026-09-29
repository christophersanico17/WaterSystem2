const { db } = require("../db/database");

const insertAudit = db.prepare(
  "INSERT INTO audit_log (actor_email, actor_name, actor_role, action, target, details) VALUES (?, ?, ?, ?, ?, ?)"
);

// Record a staff action. Reads the actor from req.user (set by authMiddleware).
// Wrapped in try/catch so a logging failure can never break the main request.
function recordAudit(req, action, target, details) {
  try {
    const actor = (req && req.user) || {};
    insertAudit.run(
      actor.email || null,
      actor.name || null,
      actor.staffRole || null,
      action,
      target != null ? String(target) : null,
      details != null ? String(details) : null
    );
  } catch (err) {
    console.error("audit log write failed:", err.message);
  }
}

module.exports = { recordAudit };
