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
//   1. Copy config.example.h to config.h and fill in your WiFi name/password
//      and the device key from the admin panel (Households → expand a
//      household → "Generate device key"). No server IP needed — the device
//      finds the server on the LAN by broadcast (see discoverServer()).
//      See ../README.md.
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
  #include <WiFiClientSecure.h>
#elif defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WiFiClientSecure.h>
#else
  #error "This sketch targets ESP8266 or ESP32 boards only."
#endif

#include <WiFiUdp.h>
#include <FS.h>

#if defined(ESP32)
  #include <SPIFFS.h>
#endif

// ── Local reading buffer (SPIFFS) ───────────────────────────
// Stores readings with timestamps during WiFi outages (max 24 hours / 500 readings)
// Format: one JSON reading per line in /readings.jsonl
// Structure: {"ts":1234567890,"pulses":1234,"intervalMs":60000}

const int MAX_BUFFERED_READINGS = 500;
const unsigned long MAX_BUFFER_AGE_MS = 24UL * 60UL * 60UL * 1000UL; // 24 hours
unsigned long lastTimeSync = 0;
bool timeIsSynced = false;

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
volatile unsigned long secondPulseCount = 0; // same pulses, but reset every second for per-second samples

// Noise filter: a loose or floating signal wire can fire this interrupt
// hundreds of thousands of times a second. A real YF-S201 at its ~30 L/min
// maximum pulses about every 4.4 ms, so edges closer together than 1 ms
// can't be water and are ignored. (The server separately discards any
// report that still works out to an impossible flow rate.)
const unsigned long MIN_PULSE_GAP_US = 1000;
volatile unsigned long lastPulseUs = 0;

void IRAM_ATTR onPulse() {
  unsigned long nowUs = micros();
  if (nowUs - lastPulseUs < MIN_PULSE_GAP_US) return;
  lastPulseUs = nowUs;
  pulseCount++;
  secondPulseCount++;
}

// ── Per-second samples ──────────────────────────────────────
// Pulses counted in each ~1-second slot since the last successful report,
// oldest first. Sent along with every report so the dashboard can show
// per-second usage without the device having to report every second (which
// would multiply requests and database rows by 10). Display-only: the
// report's total `pulses` stays the authoritative number for billing. Kept
// to the last MAX_SAMPLES slots while reports are failing.
const int MAX_SAMPLES = 60;
unsigned int samples[MAX_SAMPLES];
int sampleCount = 0;
unsigned long lastSampleMs = 0;

void takeSample() {
  noInterrupts();
  unsigned long pulses = secondPulseCount;
  secondPulseCount = 0;
  interrupts();

  if (sampleCount == MAX_SAMPLES) {
    memmove(samples, samples + 1, (MAX_SAMPLES - 1) * sizeof(samples[0]));
    sampleCount--;
  }
  samples[sampleCount++] = pulses > 65535 ? 65535 : pulses;
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

void initStorage() {
  #if defined(ESP32)
    if (!SPIFFS.begin(true)) {
      Serial.println(F("Failed to mount SPIFFS"));
      return;
    }
  #elif defined(ESP8266)
    if (!SPIFFS.begin()) {
      Serial.println(F("Failed to mount SPIFFS"));
      return;
    }
  #endif

  Serial.println(F("SPIFFS mounted, local reading buffer ready"));

  // Clean up readings older than 24 hours
  cleanupOldReadings();

  // Show buffer status
  int count = countBufferedReadings();
  Serial.printf("Buffered readings: %d / %d\n", count, MAX_BUFFERED_READINGS);
}

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

  initStorage();
  connectWiFi();
  discoverServer();
  lastReportMs = millis();
  lastSampleMs = lastReportMs;
}

void loop() {
  ensureWiFiConnected();

  if (WiFi.status() == WL_CONNECTED && serverUrl.length() == 0 && millis() - lastDiscoveryMs >= DISCOVERY_RETRY_MS) {
    discoverServer();
  }

  // On WiFi reconnect with server found: sync time and resend buffered readings
  static bool hasResynced = false;
  if (WiFi.status() == WL_CONNECTED && serverUrl.length() > 0 && !hasResynced) {
    syncTimeWithServer();
    resendBufferedReadings();
    hasResynced = true;
  } else if (WiFi.status() != WL_CONNECTED) {
    hasResynced = false; // Reset flag when WiFi drops
  }

  unsigned long now = millis();
  unsigned long elapsed = now - lastReportMs; // unsigned subtraction: correct even across millis() rollover

  if (now - lastSampleMs >= 1000) {
    takeSample();
    // Normally step exactly 1s so slots don't drift. If the loop was blocked
    // longer (a slow report, a WiFi reconnect), that one slot just covers the
    // longer span — restart the 1s rhythm from now rather than emitting a
    // burst of empty catch-up slots.
    lastSampleMs = (now - lastSampleMs >= 2000) ? now : lastSampleMs + 1000;
  }

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
      sampleCount = 0;
    }

    unsigned long totalPulses = pulses + pendingPulses;
    unsigned long totalIntervalMs = elapsed + pendingIntervalMs;

    bool reported = sendReading(totalPulses, totalIntervalMs);
    if (reported) {
      pendingPulses = 0;
      pendingIntervalMs = 0;
      sampleCount = 0;
    } else {
      pendingPulses = totalPulses;
      pendingIntervalMs = totalIntervalMs;
    }
  }
}

// ── WiFi ─────────────────────────────────────────────────────
// Connects to the network set by WIFI_SSID / WIFI_PASSWORD in config.h.
// Must be a 2.4GHz network — ESP8266/ESP32 can't see 5GHz-only ones.

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Connecting to WiFi \"%s\"", WIFI_SSID);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("WiFi connected, IP: "));
    Serial.println(WiFi.localIP());
    digitalWrite(LED_BUILTIN, LOW); // on = connected
    wasWiFiConnected = true;
  } else {
    Serial.println(F("WiFi connect timed out — check WIFI_SSID/WIFI_PASSWORD in config.h. Will keep retrying."));
  }
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wasWiFiConnected) {
      // Back online after a drop — sync time and resend buffered readings
      Serial.print(F("WiFi reconnected, IP: "));
      Serial.println(WiFi.localIP());
      digitalWrite(LED_BUILTIN, LOW);
      wasWiFiConnected = true;
      serverUrl = "";
      discoverServer();
      // Sync time and resend buffered readings once server is discovered
    }
    return;
  }
  wasWiFiConnected = false;
  digitalWrite(LED_BUILTIN, HIGH); // off = not connected
  Serial.println(F("WiFi dropped — reconnecting…"));
  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    serverUrl = "";
    discoverServer();
  }
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
    Serial.println(F("Skipping report — no WiFi. Buffering for later resend."));
    bufferReading(pulses, intervalMs);
    return false;
  }
  if (serverUrl.length() == 0) {
    Serial.println(F("Skipping report — server not found yet. Buffering for later resend."));
    bufferReading(pulses, intervalMs);
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

  String body = String("{\"pulses\":") + pulses + ",\"intervalMs\":" + intervalMs + ",\"samples\":[";
  for (int i = 0; i < sampleCount; i++) {
    if (i > 0) body += ',';
    body += samples[i];
  }
  body += "]}";
  int status = http.POST(body);
  bool ok = status == 200;

  if (ok) {
    Serial.printf("Reported %lu pulses over %lums -> %s\n", pulses, intervalMs, http.getString().c_str());
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    Serial.printf("Report failed (HTTP %d): %s — pulses carried into the next attempt.\n", status, http.getString().c_str());
    if (status < 0) {
      Serial.printf("  Connection error: %s\n", http.errorToString(status).c_str());
      if (https) {
        char sslError[100] = "";
#if defined(ESP8266)
        int sslCode = secureClient.getLastSSLError(sslError, sizeof(sslError));
#else
        int sslCode = secureClient.lastError(sslError, sizeof(sslError));
#endif
        Serial.printf("  TLS error %d: %s (free heap: %u bytes)\n", sslCode, sslError, ESP.getFreeHeap());
      }
    }
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

// ── Local reading buffer (SPIFFS) ───────────────────────────

// Sync time with the server on WiFi reconnect (first successful API request)
// Server responds with {"timestamp":1234567890}
void syncTimeWithServer() {
  if (!timeIsSynced || millis() - lastTimeSync > 3600000) { // re-sync every hour
    if (WiFi.status() != WL_CONNECTED || serverUrl.length() == 0) return;

    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    bool https = serverUrl.startsWith("https://");
    if (https) secureClient.setInsecure();

    HTTPClient http;
    String url = serverUrl + "/api/time";

    if (!(https ? http.begin(secureClient, url) : http.begin(plainClient, url))) {
      return;
    }
    http.setTimeout(5000);

    int status = http.GET();
    if (status == 200) {
      String response = http.getString();
      // Parse {"timestamp":1234567890}
      int tsPos = response.indexOf("\"timestamp\":");
      if (tsPos >= 0) {
        unsigned long ts = strtoul(response.c_str() + tsPos + 12, NULL, 10);
        if (ts > 1000000000) { // sanity check
          configTime(0, 0, "pool.ntp.org"); // UTC
          time_t now = ts;
          struct tm timeinfo = *gmtime(&now);
          mktime(&timeinfo);
          timeIsSynced = true;
          lastTimeSync = millis();
          Serial.printf("Time synced: %lu\n", ts);
        }
      }
    }
    http.end();
  }
}

// Buffer a reading to SPIFFS for later resend (when WiFi is down)
void bufferReading(unsigned long pulses, unsigned long intervalMs) {
  if (countBufferedReadings() >= MAX_BUFFERED_READINGS) {
    Serial.println(F("Buffer full — oldest reading dropped"));
    // Remove oldest reading (first line)
    File oldFile = SPIFFS.open("/readings.jsonl", "r");
    File newFile = SPIFFS.open("/readings.tmp", "w");
    bool skipFirst = true;
    String line = "";
    while (oldFile.available()) {
      char c = oldFile.read();
      if (c == '\n') {
        if (!skipFirst) newFile.println(line);
        skipFirst = false;
        line = "";
      } else {
        line += c;
      }
    }
    oldFile.close();
    newFile.close();
    SPIFFS.remove("/readings.jsonl");
    SPIFFS.rename("/readings.tmp", "/readings.jsonl");
  }

  File f = SPIFFS.open("/readings.jsonl", "a");
  time_t now = time(nullptr);
  String json = String("{\"ts\":") + now + ",\"pulses\":" + pulses + ",\"intervalMs\":" + intervalMs + "}";
  f.println(json);
  f.close();

  Serial.printf("Buffered: %s\n", json.c_str());
}

// Count readings in buffer
int countBufferedReadings() {
  if (!SPIFFS.exists("/readings.jsonl")) return 0;
  File f = SPIFFS.open("/readings.jsonl", "r");
  int count = 0;
  while (f.available()) {
    if (f.read() == '\n') count++;
  }
  f.close();
  return count;
}

// Remove readings older than 24 hours
void cleanupOldReadings() {
  if (!SPIFFS.exists("/readings.jsonl")) return;

  time_t now = time(nullptr);
  unsigned long now_ms = millis();
  if (!timeIsSynced) now = now_ms / 1000; // Use millis as approximation

  File oldFile = SPIFFS.open("/readings.jsonl", "r");
  File newFile = SPIFFS.open("/readings.tmp", "w");
  String line = "";

  while (oldFile.available()) {
    char c = oldFile.read();
    if (c == '\n') {
      // Parse {"ts":1234567890,...}
      int tsPos = line.indexOf("\"ts\":");
      if (tsPos >= 0) {
        unsigned long ts = strtoul(line.c_str() + tsPos + 5, NULL, 10);
        unsigned long age = now > ts ? now - ts : 0;
        if (age < MAX_BUFFER_AGE_MS / 1000) {
          newFile.println(line);
        } else {
          Serial.printf("Discarding buffered reading (age: %lus)\n", age);
        }
      }
      line = "";
    } else {
      line += c;
    }
  }
  oldFile.close();
  newFile.close();
  SPIFFS.remove("/readings.jsonl");
  SPIFFS.rename("/readings.tmp", "/readings.jsonl");
}

// Batch resend all buffered readings when WiFi comes back
void resendBufferedReadings() {
  if (!SPIFFS.exists("/readings.jsonl")) return;

  Serial.println(F("Resending buffered readings…"));
  File f = SPIFFS.open("/readings.jsonl", "r");
  int sent = 0;
  String line = "";

  while (f.available()) {
    char c = f.read();
    if (c == '\n') {
      // Parse and send each line
      int pulPos = line.indexOf("\"pulses\":");
      int intPos = line.indexOf("\"intervalMs\":");
      if (pulPos >= 0 && intPos >= 0) {
        unsigned long pulses = strtoul(line.c_str() + pulPos + 9, NULL, 10);
        unsigned long intervalMs = strtoul(line.c_str() + intPos + 13, NULL, 10);

        if (sendReading(pulses, intervalMs)) {
          sent++;
          delay(100); // stagger requests
        } else {
          f.close();
          Serial.printf("Buffered resend stopped after %d successful sends\n", sent);
          return; // Stop if one fails — will retry next time
        }
      }
      line = "";
    } else {
      line += c;
    }
  }
  f.close();

  // Clear buffer on success
  SPIFFS.remove("/readings.jsonl");
  Serial.printf("Resent %d buffered readings\n", sent);
}
