const express = require("express");
const { verifyToken } = require("../utils/auth");
const events = require("../utils/events");

const router = express.Router();

// GET /api/events/stream — Server-Sent Events feed of live 'reading' and
// 'alert' events for the admin dashboard. Browsers' EventSource API can't
// set an Authorization header, so the admin JWT is passed as ?token=
// instead and verified the same way authMiddleware would.
router.get("/stream", (req, res) => {
  const payload = verifyToken(req.query.token || "");
  if (!payload || payload.role !== "admin") {
    return res.status(401).json({ error: "Missing or invalid admin token." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx) so events aren't delayed
  });
  res.flushHeaders?.();
  res.write(`event: connected\ndata: {}\n\n`);

  events.subscribe(res);

  // Keep the connection alive through idle timeouts / proxies.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    events.unsubscribe(res);
  });
});

module.exports = router;
