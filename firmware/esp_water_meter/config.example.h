// Copy this file to config.h (same folder) and fill in your own values.
// config.h holds your WiFi password and device secret, so it's git-ignored —
// never commit it.

// ── WiFi ─────────────────────────────────────────────────────
#define WIFI_SSID     "YourWiFiName"
#define WIFI_PASSWORD "YourWiFiPassword"

// ── Server ───────────────────────────────────────────────────
// The machine running the backend (`npm start` in /server), reachable from
// the ESP's network. On Windows, find your PC's LAN IP with `ipconfig`
// (look for "IPv4 Address" on the adapter your WiFi router is on) — it's
// usually NOT 127.0.0.1/localhost, since that only means "this device"
// and the ESP is a separate physical device on the network.
// Example: "http://192.168.1.50:4000"
#define SERVER_URL "http://192.168.1.50:4000"

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
