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
//   1. Copy config.example.h to config.h and fill in the device key from the
//      admin panel (Households → expand a household → "Generate device
//      key"). No server IP needed — the device finds the server on the LAN
//      by broadcast (see discoverServer()). See ../README.md.
//   2. Board Manager: install "esp8266" (for NodeMCU/Wemos) or "esp32"
//      (for ESP32 dev boards) via Tools → Board → Boards Manager.
//   3. Library Manager: install "WiFiManager" by tzapu (search "WiFiManager",
//      pick the one by tzapu — not "WiFiManager" by anyone else). Handles
//      WiFi setup: no SSID/password in code at all — see the WiFi section
//      below and the setup guide for how first-time pairing works.
//   4. Select your board, the correct port, and upload.
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
  #include <WiFiClientSecure.h>
#elif defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WiFiClientSecure.h>
#else
  #error "This sketch targets ESP8266 or ESP32 boards only."
#endif

#include <WiFiUdp.h>
#include <WiFiManager.h> // tzapu/WiFiManager — Library Manager, search "WiFiManager"

WiFiManager wifiManager;

// ── Server discovery ────────────────────────────────────────
// Filled in at runtime by discoverServer() (e.g. "http://192.168.254.144:4000")
// rather than hardcoded, so the device keeps working when the PC running the
// backend moves to another network or gets a new IP. Empty = unknown; reports
// are held (pulses carried forward) until discovery succeeds.
String serverUrl = "";
unsigned long lastDiscoveryMs = 0;
const unsigned long DISCOVERY_RETRY_MS = 15000;
// This many failed reports in a row (server unreachable) means the server
// probably moved — forget its address and discover it again.
const unsigned long REDISCOVER_AFTER_FAILURES = 3;
bool wasWiFiConnected = false;

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
  discoverServer();
  lastReportMs = millis();
}

void loop() {
  ensureWiFiConnected();

  if (WiFi.status() == WL_CONNECTED && serverUrl.length() == 0 && millis() - lastDiscoveryMs >= DISCOVERY_RETRY_MS) {
    discoverServer();
  }

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
// WiFiManager remembers the network you connect it to (saved in the ESP's
// flash) and reconnects to it automatically on every future boot — no SSID
// or password in this code at all. If it can't find/connect to that saved
// network (first boot ever, or you've moved the device), it opens its own
// temporary WiFi hotspot named SETUP_AP_NAME so you can pick a nearby
// network and enter its password from a phone or laptop. See the setup
// guide for the step-by-step walkthrough of that first-time pairing.

void connectWiFi() {
  WiFi.mode(WIFI_STA);

  // Give the setup portal a time limit so an unattended device doesn't sit
  // forever broadcasting its hotspot if nobody's there to configure it —
  // it just reboots and tries the saved network again instead.
  wifiManager.setConfigPortalTimeout(180); // 3 minutes

  Serial.println(F("Connecting to the last saved WiFi network…"));
  bool connected = wifiManager.autoConnect(SETUP_AP_NAME);

  if (!connected) {
    Serial.println(F("No network chosen within the setup window — restarting to try again."));
    delay(1000);
    ESP.restart();
  }

  Serial.print(F("WiFi connected, IP: "));
  Serial.println(WiFi.localIP());
  digitalWrite(LED_BUILTIN, LOW); // on = connected
  wasWiFiConnected = true;
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wasWiFiConnected) {
      // Back online after a drop — possibly on a different network, so the
      // old server address can't be trusted. Rediscover right away.
      Serial.print(F("WiFi reconnected, IP: "));
      Serial.println(WiFi.localIP());
      digitalWrite(LED_BUILTIN, LOW);
      wasWiFiConnected = true;
      serverUrl = "";
      discoverServer();
    }
    return;
  }
  wasWiFiConnected = false;
  digitalWrite(LED_BUILTIN, HIGH); // off = not connected
  Serial.println(F("WiFi dropped — reconnecting to the saved network…"));
  // The saved network's credentials already live in flash, so a plain
  // reconnect (no portal) is enough for a normal drop like the router
  // rebooting. If the saved network is truly gone for good, re-running the
  // full setup portal happens the next time the device is power-cycled.
  WiFi.reconnect();
}

// ── Server discovery ─────────────────────────────────────────
// Broadcasts "BKWS_DISCOVER" to the whole subnet on DISCOVERY_PORT; the
// backend (server/src/utils/discovery.js) replies "BKWS_SERVER <httpPort>",
// and the reply's source IP is the server's address. Uses the subnet's
// directed broadcast (e.g. 192.168.254.255) rather than 255.255.255.255,
// which some routers and the ESP8266 stack handle less reliably.

bool discoverServer() {
  lastDiscoveryMs = millis();

#ifdef SERVER_URL
  // Fixed address configured (e.g. the cloud-hosted server) — reachable from
  // any network, so there's nothing to discover.
  serverUrl = SERVER_URL;
  return true;
#endif

  if (WiFi.status() != WL_CONNECTED) return false;

  IPAddress ip = WiFi.localIP();
  IPAddress mask = WiFi.subnetMask();
  IPAddress broadcast(ip[0] | ~mask[0], ip[1] | ~mask[1], ip[2] | ~mask[2], ip[3] | ~mask[3]);

  WiFiUDP udp;
  udp.begin(DISCOVERY_PORT + 1); // any free local port, just to receive the reply

  Serial.print(F("Looking for the server on the local network…"));
  for (int attempt = 0; attempt < 3; attempt++) {
    udp.beginPacket(broadcast, DISCOVERY_PORT);
    udp.print("BKWS_DISCOVER");
    udp.endPacket();

    unsigned long start = millis();
    while (millis() - start < 1500) {
      int size = udp.parsePacket();
      if (size > 0) {
        char buf[48];
        int len = udp.read(buf, sizeof(buf) - 1);
        buf[len > 0 ? len : 0] = '\0';
        int port = 0;
        if (sscanf(buf, "BKWS_SERVER %d", &port) == 1 && port > 0) {
          serverUrl = String("http://") + udp.remoteIP().toString() + ":" + port;
          udp.stop();
          Serial.print(F(" found at "));
          Serial.println(serverUrl);
          return true;
        }
      }
      delay(10);
    }
    Serial.print('.');
  }
  udp.stop();

  Serial.println(F(" no answer. Is the server running on this WiFi network, and is UDP port 4001 allowed through the PC's firewall? Retrying shortly."));
  return false;
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
  if (serverUrl.length() == 0) {
    Serial.println(F("Skipping report — server not found yet. Pulses will be included in the next successful report."));
    return false;
  }

  // Plain HTTP for a server on the local network, HTTPS for the cloud-hosted
  // one. setInsecure() encrypts the connection but skips verifying the
  // server's certificate — the ESP has no practical way to keep a CA bundle
  // or a pinned fingerprint current as the host rotates certificates. The
  // device key still authenticates the device to the server.
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  bool https = serverUrl.startsWith("https://");
  if (https) secureClient.setInsecure();

  HTTPClient http;
  String url = serverUrl + "/api/devices/readings";

  if (!(https ? http.begin(secureClient, url) : http.begin(plainClient, url))) {
    Serial.println(F("http.begin() failed — bad server address, rediscovering."));
    serverUrl = "";
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
    Serial.println(F("Common causes: wrong/revoked DEVICE_KEY, or the server isn't reachable from this network."));
    // Negative status = connection-level failure (nothing answered at that
    // address), unlike a 4xx/5xx where the server was found but refused.
    // A few of those in a row means the server likely moved — find it again.
    if (status < 0 && consecutiveFailures >= REDISCOVER_AFTER_FAILURES) {
      Serial.println(F("Server unreachable at the last known address — rediscovering."));
      serverUrl = "";
      lastDiscoveryMs = 0;
    }
  }

  http.end();

  // Blink to give a field technician a quick visual without needing a
  // laptop plugged in: brief flash on success, longer flash on failure.
  digitalWrite(LED_BUILTIN, HIGH);
  delay(ok ? 60 : 250);
  digitalWrite(LED_BUILTIN, LOW);

  return ok;
}
