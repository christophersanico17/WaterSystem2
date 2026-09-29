const express = require("express");
const { db } = require("../db/database");
const { authMiddleware } = require("../utils/auth");

const router = express.Router();

// GET /api/audit — recent staff actions. Water Officer only.
// Optional ?limit= (default 200, capped at 500).
router.get("/", authMiddleware("admin", ["officer"]), (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  const rows = db
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit);
  res.json(
    rows.map((r) => ({
      id: r.id,
      actorEmail: r.actor_email,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      action: r.action,
      target: r.target,
      details: r.details,
      createdAt: r.created_at,
    }))
  );
});

module.exports = router;
