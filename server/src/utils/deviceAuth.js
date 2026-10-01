const { db } = require("../db/database");

// Authenticates an ESP/Arduino device by its per-household secret key,
// sent as the `X-Device-Key` header. Deliberately separate from the
// resident/admin JWT auth in utils/auth.js — a flow-meter device has no
// "user" to log in as, and its key is long-lived (set once at provisioning,
// not a short-expiry session token) since re-flashing hardware in the field
// to refresh a token isn't practical.
function deviceAuthMiddleware(req, res, next) {
  const key = req.headers["x-device-key"];
  if (!key || typeof key !== "string") {
    return res.status(401).json({ error: "Missing X-Device-Key header." });
  }

  const household = db.prepare("SELECT * FROM households WHERE device_key = ?").get(key);
  if (!household) {
    return res.status(401).json({ error: "Invalid device key." });
  }

  req.household = household;
  next();
}

module.exports = { deviceAuthMiddleware };
