// Copy this file to config.h (same folder) and fill in your own values.
// config.h holds your device secret, so it's git-ignored — never commit it.

// ── WiFi ─────────────────────────────────────────────────────
// No SSID/password here — the ESP connects to WiFi via WiFiManager (see
// esp_water_meter.ino), which remembers whatever network you picked through
// its setup portal and reconnects automatically on every boot.

// Name of the temporary setup WiFi hotspot the ESP opens when it has no
// saved network yet (or can't find it). Change this if you're provisioning
// more than one device and want to tell them apart while pairing.
#define SETUP_AP_NAME "BKWS-Setup"

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

// How often to report, in milliseconds. 10 seconds is a good default —
// frequent enough for the admin dashboard to feel live, infrequent enough
// not to spam the network or the server. The device-side rate limit allows
// up to one report/second if you want it more frequent.
#define REPORT_INTERVAL_MS 10000
