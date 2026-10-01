// Thin wrapper around the PayMongo API (https://docs.paymongo.com).
//
// We use PayMongo Checkout Sessions to collect resident water-bill payments.
// A Checkout Session is created server-side (this file), the resident is
// redirected to PayMongo's hosted checkout_url, and PayMongo redirects them
// back to `success_url` / `cancel_url` once they're done. Because a redirect
// can be closed early or lost, the bill is only ever marked Paid after we
// (a) independently re-check the session with PayMongo via
// `retrieveCheckoutSession` + `isCheckoutSessionPaid`, or (b) receive a
// signed webhook — never from the client telling us "I paid."
const crypto = require("crypto");

const BASE_URL = process.env.PAYMONGO_BASE_URL || "https://api.paymongo.com/v1";

function secretKey() {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) {
    throw new Error(
      "PAYMONGO_SECRET_KEY is not configured on the server (see server/.env.example)."
    );
  }
  return key;
}

function authHeader() {
  // PayMongo uses HTTP Basic auth with the secret key as the username and an
  // empty password, same as Stripe.
  return "Basic " + Buffer.from(`${secretKey()}:`).toString("base64");
}

async function paymongoRequest(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const wrapped = new Error("Could not reach PayMongo: " + err.message);
    wrapped.cause = err;
    throw wrapped;
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    // no/invalid JSON body — fall through, response.ok check below still fires
  }

  if (!response.ok) {
    const detail = json?.errors?.[0]?.detail || `PayMongo request failed (${response.status}).`;
    const err = new Error(detail);
    err.status = response.status;
    err.paymongo = json;
    throw err;
  }

  return json;
}

// Creates a hosted Checkout Session for a single water bill and returns the
// raw PayMongo response ({ data: { id, attributes: { checkout_url, ... } } }).
//
// We ask for GCash specifically (matching the resident-facing "Pay with
// GCash" button elsewhere in the app), but some PayMongo test accounts don't
// have every e-wallet rail enabled yet — if the API rejects the requested
// payment_method_types we retry once without that restriction rather than
// hard-failing the whole payment.
async function createCheckoutSession({
  amountPesos,
  description,
  referenceNumber,
  successUrl,
  cancelUrl,
  metadata,
}) {
  const attributes = {
    line_items: [
      {
        name: description,
        amount: Math.round(amountPesos * 100), // PHP -> centavos
        currency: "PHP",
        quantity: 1,
      },
    ],
    payment_method_types: ["gcash"],
    success_url: successUrl,
    cancel_url: cancelUrl,
    reference_number: referenceNumber,
    description,
    show_line_items: true,
    show_description: true,
    metadata,
  };

  try {
    return await paymongoRequest("/checkout_sessions", {
      method: "POST",
      body: { data: { attributes } },
    });
  } catch (err) {
    const rejectedMethodType = err.status === 400 || err.status === 422;
    if (rejectedMethodType) {
      const fallbackAttributes = { ...attributes };
      delete fallbackAttributes.payment_method_types;
      return await paymongoRequest("/checkout_sessions", {
        method: "POST",
        body: { data: { attributes: fallbackAttributes } },
      });
    }
    throw err;
  }
}

async function retrieveCheckoutSession(id) {
  return paymongoRequest(`/checkout_sessions/${encodeURIComponent(id)}`);
}

// PayMongo's Checkout Session resource has carried payment status a couple
// of different ways across API versions, so check defensively rather than
// assume one exact shape.
function isCheckoutSessionPaid(session) {
  const attrs = session?.data?.attributes;
  if (!attrs) return false;

  if (Array.isArray(attrs.payments) && attrs.payments.length > 0) {
    if (attrs.payments.some((p) => p?.attributes?.status === "paid")) return true;
  }

  const intentStatus =
    attrs.payment_intent?.attributes?.status || attrs.payment_intent?.status;
  if (intentStatus === "succeeded") return true;

  if (attrs.status === "paid" || attrs.status === "completed") return true;

  return false;
}

// Verifies the `Paymongo-Signature` header PayMongo sends on webhook
// requests. Format: "t=<unix ts>,te=<test-mode hmac>,li=<live-mode hmac>",
// where the hmac is HMAC-SHA256("<t>.<raw body>", webhook_signing_secret)
// hex-digested — the same scheme Stripe popularized and PayMongo modeled
// theirs after. Requires the *raw* request body (not the parsed JSON).
function verifyWebhookSignature(rawBody, signatureHeader, signingSecret, { live = false } = {}) {
  if (!signingSecret || !signatureHeader) return false;

  const parts = {};
  for (const pair of signatureHeader.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }

  const timestamp = parts.t;
  const candidate = live ? parts.li : parts.te;
  if (!timestamp || !candidate) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", signingSecret).update(signedPayload).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const candidateBuf = Buffer.from(candidate, "hex");
  if (expectedBuf.length !== candidateBuf.length) return false;

  try {
    return crypto.timingSafeEqual(expectedBuf, candidateBuf);
  } catch {
    return false;
  }
}

module.exports = {
  createCheckoutSession,
  retrieveCheckoutSession,
  isCheckoutSessionPaid,
  verifyWebhookSignature,
};
