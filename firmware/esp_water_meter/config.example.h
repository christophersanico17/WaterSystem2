// Copy this file to config.h (same folder) and fill in your own values.
// config.h holds your WiFi password and device secret, so it's git-ignored —
// never commit it.

// ── WiFi ─────────────────────────────────────────────────────
// Must be a 2.4GHz network (ESP8266/ESP32 can't use 5GHz). For local
// testing, use the same WiFi your PC running the server is on.
#define WIFI_SSID     "YourWiFiName"
#define WIFI_PASSWORD "YourWiFiPassword"

// ── Server ───────────────────────────────────────────────────
// Deployed (cloud-hosted) server: set its public URL here. The meter then
// reports to it from any WiFi network, over HTTPS. This is the normal setup
// for meters installed in households.
// #define SERVER_URL "https://your-app.up.railway.app"

// Local development: leave SERVER_URL commented out and the ESP finds a
// server running on the same WiFi network automatically, by broadcast (the
// server answers from utils/discovery.js). Re-runs whenever WiFi reconnects
// or reports keep failing, so it follows the PC across IP changes. Must
// match DISCOVERY_PORT on the server (default 4001).
#define DISCOVERY_PORT 4001

// From the admin panel: Households → expand the household this meter
// belongs to → "Generate device key". Shown once — copy it here right away.
// Regenerating the key in the admin panel invalidates this value.
#define DEVICE_KEY "dev_paste_your_device_key_here"

// ── Flow sensor ──────────────────────────────────────────────
// GPIO pin the sensor's yellow/signal wire is connected to. Must support
// interrupts (on ESP8266, avoid GPIO16/D0 — it can't). Common choices:
//   NodeMCU / Wemos D1 Mini: D5 (GPIO14) or D6 (GPIO12)
//   ESP32 dev board:         GPIO27 or GPIO26
#define FLOW_SENSOR_PIN D5

// How often to report, in milliseconds. 15 seconds keeps the dashboard
// feeling live while keeping requests (and the ngrok free plan's monthly
// quota) and database rows moderate; each report also carries per-second
// counts for the dashboard's per-second chart. The server accepts up to 120
// per-second samples, so keep this at 120000 or less.
#define REPORT_INTERVAL_MS 15000
