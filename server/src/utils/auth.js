const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is not set. Add it to server/.env before starting the server (see server/.env.example)."
  );
}
const TOKEN_EXPIRY = "7d";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// requiredRole   — "admin" | "resident" (the broad token audience)
// allowedStaffRoles — optional list, e.g. ["officer"], restricting which admin
//                     staff roles may pass. Omit to allow any admin.
function authMiddleware(requiredRole, allowedStaffRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Missing authorization token." });
    }
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    if (requiredRole && payload.role !== requiredRole) {
      return res.status(403).json({ error: "You do not have access to this resource." });
    }
    if (
      allowedStaffRoles &&
      allowedStaffRoles.length &&
      !allowedStaffRoles.includes(payload.staffRole)
    ) {
      return res.status(403).json({ error: "This action requires the Water Officer role." });
    }
    req.user = payload;
    next();
  };
}

// Decodes the Authorization header if present and valid, but never rejects
// the request — for endpoints that behave differently for admin vs resident
// vs anonymous callers rather than requiring any one of them. Returns the
// JWT payload ({ role, email, ... } or { role, householdId }), or null if
// there's no token, it's malformed, or it's expired/invalid.
function optionalAuth(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  return verifyToken(token);
}

module.exports = { signToken, verifyToken, authMiddleware, optionalAuth };