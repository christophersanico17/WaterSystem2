require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

require("./db/database"); // ensures schema is created on boot

const residentAuthRoutes = require("./routes/residentAuth");
const adminAuthRoutes = require("./routes/adminAuth");
const dataRoutes = require("./routes/data");
const announcementRoutes = require("./routes/announcements");
const auditRoutes = require("./routes/audit");
const webhookRoutes = require("./routes/webhooks");
const deviceRoutes = require("./routes/devices");
const eventRoutes = require("./routes/events");
const settingsRoutes = require("./routes/settings");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

// Webhook routes need the raw request body to verify signatures, so they're
// mounted with express.raw() ahead of the global express.json() parser below
// (which would otherwise consume and re-serialize the body first).
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Brute-force protection on login endpoints, shared across all of them per IP.
// 50/15min still meaningfully throttles automated guessing (on top of bcrypt's
// inherent per-attempt cost) without tripping during normal interactive testing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again later." },
});

app.use("/api/resident/login", loginLimiter);
app.use("/api/resident/google-login", loginLimiter);
app.use("/api/resident/forgot-password", loginLimiter);
app.use("/api/resident/reset-password", loginLimiter);
app.use("/api/admin/login", loginLimiter);
app.use("/api/admin/forgot-password", loginLimiter);
app.use("/api/admin/reset-password", loginLimiter);

app.use("/api/resident", residentAuthRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/events", eventRoutes);
// deviceRoutes declares its own full paths (/devices/readings,
// /households/:id/device...), so it's mounted at the bare /api root like
// dataRoutes, not under an extra /api/devices prefix.
app.use("/api", deviceRoutes);
app.use("/api", dataRoutes);
app.use("/api", settingsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`\n  Barangay Kinamlutan Water System API`);
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/api/health\n`);
});

// Periodic sweep for devices that have gone silent (dead battery, lost
// Wi-Fi, etc.) — see routes/devices.js. Real-time flow/leak detection runs
// inline as readings arrive, but a device that stops reporting entirely
// never triggers that path, so it needs its own check on a timer.
deviceRoutes.startDeviceSilenceMonitor();