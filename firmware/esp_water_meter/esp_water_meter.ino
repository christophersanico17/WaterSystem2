// Barangay Kinamlutan Water System — flow-sensor meter firmware
// ────────────────────────────────────────────────────────────
// Runs on an ESP8266 (NodeMCU / Wemos D1 Mini) or ESP32 dev board wired to a
// pulse-output water flow sensor (e.g. YF-S201/YF-S401 hall-effect sensor)
// installed in-line with a household's pipe/pump. Every REPORT_INTERVAL_MS
// it reports how many pulses it counted and over what span of time — the
// server does the liters/flow-rate math using that household's calibration
// factor, so recalibrating never requires reflashing a device in the field.
//
// Setup:
//   1. Copy config.example.h to config.h and fill in your WiFi + server
//      details and the device key from the admin panel (Households →
//      expand a household → "Generate device key"). See ../README.md.
//   2. Board Manager: install "esp8266" (for NodeMCU/Wemos) or "esp32"
//      (for ESP32 dev boards) via Tools → Board → Boards Manager.
//   3. Select your board, the correct port, and upload.
//
// Wiring (see ../README.md for the full diagram):
//   Flow sensor VCC (red)    -> 5V / VIN
//   Flow sensor GND (black)  -> GND (common ground with the ESP)
//   Flow sensor signal (yellow) -> FLOW_SENSOR_PIN (config.h)

#include "config.h"

#if defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266HTTPClient.h>
  #include <WiFiClient.h>
#elif defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
#else
  #error "This sketch targets ESP8266 or ESP32 boards only."
#endif

// ── Pulse counting ──────────────────────────────────────────
// The flow sensor's hall-effect switch fires an interrupt on every rotation
// of its internal turbine. We only ever touch pulseCount from the ISR and
// from the main loop with interrupts briefly disabled, so a pulse can never
// be counted twice or dropped between the two.
volatile unsigned long pulseCount = 0;

void IRAM_ATTR onPulse() {
  pulseCount++;
}

unsigned long lastReportMs = 0;
unsigned long consecutiveFailures = 0;

// A report that doesn't land (WiFi down, server unreachable, restarting,
// revoked key, rate-limited...) carries its pulses AND the real wall-clock
// span they were collected over into the next attempt — carrying only the
// pulses and re-measuring a fresh REPORT_INTERVAL_MS window would understate
// how long they took to arrive and make the next report's flow rate look
// higher than it really was. If the carried span grows past
// MAX_PENDING_INTERVAL_MS (kept just under the server's accepted intervalMs
// range — see routes/devices.js), the outage has gone on long enough that
// it's dropped instead: an outage that long already means some usage during
// it can't be reconstructed, and forcing it into a shorter interval would
// just make the eventual report look like a flow burst that never happened.
unsigned long pendingPulses = 0;
unsigned long pendingIntervalMs = 0;
const unsigned long MAX_PENDING_INTERVAL_MS = 9UL * 60UL * 1000UL;

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println(F("Barangay Kinamlutan Water System — flow meter starting…"));

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH); // most boards: LOW = on, HIGH = off

  // INPUT_PULLUP: most low-cost hall-effect flow sensors pull the signal
  // line low on each pulse (open-collector-ish behavior) and float
  // otherwise — the internal pull-up keeps the idle level well-defined
  // instead of floating and triggering phantom interrupts.
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), onPulse, FALLING);

  connectWiFi();
  lastReportMs = millis();
}

void loop() {
  ensureWiFiConnected();

  unsigned long now = millis();
  unsigned long elapsed = now - lastReportMs; // unsigned subtraction: correct even across millis() rollover

  if (elapsed >= REPORT_INTERVAL_MS) {
    // Snapshot and reset the counter with interrupts off just long enough
    // to make the read-then-clear atomic — a pulse arriving mid-snapshot
    // must land cleanly in either this window or the next one, never lost.
    noInterrupts();
    unsigned long pulses = pulseCount;
    pulseCount = 0;
    interrupts();

    lastReportMs = now;

    // If carried-forward debt has already grown past what the server will
    // accept as a single interval, the outage has gone on long enough that
    // some usage during it can't be reconstructed — drop the debt rather
    // than let it grow forever (every future attempt would just keep getting
    // rejected as out-of-range too) or force it into a shorter interval
    // (which would make the eventual flow rate look like a burst/leak that
    // never actually happened).
    if (pendingIntervalMs > 0 && pendingIntervalMs + elapsed > MAX_PENDING_INTERVAL_MS) {
      Serial.println(F("Outage exceeded the carry-forward window — discarding undelivered pulses to avoid reporting a false flow spike."));
      pendingPulses = 0;
      pendingIntervalMs = 0;
    }

    unsigned long totalPulses = pulses + pendingPulses;
    unsigned long totalIntervalMs = elapsed + pendingIntervalMs;

    bool reported = sendReading(totalPulses, totalIntervalMs);
    if (reported) {
      pendingPulses = 0;
      pendingIntervalMs = 0;
    } else {
      pendingPulses = totalPulses;
      pendingIntervalMs = totalIntervalMs;
    }
  }
}

// ── WiFi ─────────────────────────────────────────────────────

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Connecting to WiFi \"%s\"", WIFI_SSID);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print(F("WiFi connected, IP: "));
    Serial.println(WiFi.localIP());
    digitalWrite(LED_BUILTIN, LOW); // on = connected
  } else {
    Serial.println();
    Serial.println(F("WiFi connect timed out — will keep retrying in the main loop."));
  }
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;
  digitalWrite(LED_BUILTIN, HIGH); // off = not connected
  Serial.println(F("WiFi dropped — reconnecting…"));
  connectWiFi();
}

// ── Reporting ────────────────────────────────────────────────

// Returns true on a confirmed (HTTP 200) report. On false, the caller
// (loop()) is responsible for carrying pulses/intervalMs forward — this
// function only ever attempts to send, it never mutates pulseCount or the
// pending totals itself.
bool sendReading(unsigned long pulses, unsigned long intervalMs) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("Skipping report — no WiFi. Pulses will be included in the next successful report."));
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/readings";

  if (!http.begin(client, url)) {
    Serial.println(F("http.begin() failed — check SERVER_URL in config.h"));
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.setTimeout(8000);

  String body = String("{\"pulses\":") + pulses + ",\"intervalMs\":" + intervalMs + "}";
  int status = http.POST(body);
  bool ok = status == 200;

  if (ok) {
    Serial.printf("Reported %lu pulses over %lums -> %s\n", pulses, intervalMs, http.getString().c_str());
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    Serial.printf("Report failed (HTTP %d): %s — pulses carried into the next attempt.\n", status, http.getString().c_str());
    Serial.println(F("Common causes: wrong SERVER_URL/port, wrong/revoked DEVICE_KEY, or the server isn't reachable from this network."));
  }

  http.end();

  // Blink to give a field technician a quick visual without needing a
  // laptop plugged in: brief flash on success, longer flash on failure.
  digitalWrite(LED_BUILTIN, HIGH);
  delay(ok ? 60 : 250);
  digitalWrite(LED_BUILTIN, LOW);

  return ok;
}
