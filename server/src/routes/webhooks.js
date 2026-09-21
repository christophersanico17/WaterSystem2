const express = require("express");
const { db } = require("../db/database");
const { recordAudit } = require("../utils/audit");
const paymongo = require("../utils/paymongo");

const router = express.Router();

// POST /api/webhooks/paymongo — PayMongo calls this when a checkout session's
// payment status changes. This is the production-grade confirmation path;
// /api/bills/:id/gcash/sync (polled by the frontend) covers the same ground
// for local development, where PayMongo has no public URL to deliver to.
//
// Mounted with express.raw() (see server/src/index.js) so req.body is the
// exact bytes PayMongo signed — signature verification fails on re-serialized
// JSON, which won't byte-for-byte match what was sent.
router.post("/paymongo", (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : "";
  const signatureHeader = req.headers["paymongo-signature"];
  const signingSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

  if (!signingSecret) {
    // Not configured — most likely local development, where PayMongo has no
    // public URL to reach anyway. Acknowledge so PayMongo doesn't retry, but
    // don't process anything unverified.
    console.warn("PayMongo webhook received but PAYMONGO_WEBHOOK_SECRET is not set — ignoring.");
    return res.status(200).json({ received: true, verified: false });
  }

  const live = process.env.PAYMONGO_SECRET_KEY?.startsWith("sk_live_");
  const verified = paymongo.verifyWebhookSignature(rawBody, signatureHeader, signingSecret, { live });
  if (!verified) {
    return res.status(400).json({ error: "Invalid webhook signature." });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }

  const type = event?.data?.attributes?.type;
  const resource = event?.data?.attributes?.data;

  const isPaidEvent =
    type === "checkout_session.payment.paid" ||
    type === "payment.paid" ||
    type === "payment_intent.succeeded";

  if (isPaidEvent) {
    // The checkout session id is the resource itself for
    // checkout_session.payment.paid, or reachable via metadata for
    // payment/payment_intent events.
    const sessionId = resource?.id || resource?.attributes?.metadata?.checkout_session_id;
    const billId = resource?.attributes?.metadata?.billId;

    const bill = billId
      ? db.prepare("SELECT * FROM bills WHERE id = ?").get(billId)
      : sessionId
      ? db.prepare("SELECT * FROM bills WHERE payment_ref = ?").get(sessionId)
      : null;

    if (bill && bill.payment_status !== "Paid") {
      db.prepare(
        `UPDATE bills SET payment_status = 'Paid', payment_date = datetime('now') WHERE id = ?`
      ).run(bill.id);
      recordAudit(
        { user: { email: "paymongo-webhook", staffRole: "system" } },
        "bill.gcash_webhook_confirmed",
        bill.household_id,
        `PayMongo webhook confirmed payment for ${bill.household_id} (${bill.period})`
      );
    }
  }

  res.status(200).json({ received: true, verified: true });
});

module.exports = router;
