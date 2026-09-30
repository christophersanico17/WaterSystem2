# Real-time water meter hardware (Arduino/ESP + flow sensor)

This turns a household's water connection into a live IoT meter: a
pulse-output flow sensor counts water passing through the pipe, an ESP8266
or ESP32 board reports those pulses over WiFi, and the backend converts
pulses into liters, updates that household's live consumption, feeds the
admin dashboard in real time, and rolls straight into the next generated
bill — no manual meter reading.

## What you need (per household)

- An ESP8266 board (NodeMCU or Wemos D1 Mini — cheapest option) **or**
  an ESP32 dev board.
- A pulse-output water flow sensor, e.g. **YF-S201** (½" NPT, hall-effect,
  ~450 pulses/liter) or similar. Any sensor with a 3-wire VCC/GND/signal
  pulse output works — you calibrate its exact pulses-per-liter from the
  admin panel, so it doesn't have to be this exact model.
- 3 jumper wires, a 5V USB power supply (or the ESP's onboard regulator
  from VIN if you're already running 5V to it).
- The flow sensor installed in-line with the household's pipe, after the
  main shutoff, oriented per the arrow molded into its body (flow
  direction matters — hall-effect sensors don't count backwards flow).

## Wiring

```
 Flow sensor                      ESP8266 (NodeMCU) / ESP32
 ───────────                      ──────────────────────────
 Red    (VCC)   ───────────────►  5V / VIN
 Black  (GND)   ───────────────►  GND
 Yellow (Signal)───────────────►  D5 (GPIO14) on ESP8266
                                   GPIO27 on ESP32
                                   (must be an interrupt-capable pin —
                                    see config.example.h for other options)
```

Most of these sensors run their signal line as an open-collector output
that pulls low on each pulse — the firmware enables the ESP's internal
pull-up resistor (`INPUT_PULLUP`) on that pin, so no external resistor is
needed for a standard YF-S201-style sensor.

## Software setup

1. Install the Arduino IDE, then add board support:
   **File → Preferences → Additional Board URLs**, add whichever you need:
   - ESP8266: `https://arduino.esp8266.com/stable/package_esp8266com_index.json`
   - ESP32: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`

   Then **Tools → Board → Boards Manager**, search and install "esp8266"
   or "esp32".
2. Open `esp_water_meter/esp_water_meter.ino`.
3. In the same folder, copy `config.example.h` to `config.h` and fill in:
   - Your WiFi SSID/password.
   - `DEVICE_KEY` — see **Provisioning** below.
   - `SERVER_URL`: the cloud server's public URL
     (`https://...up.railway.app`, see `../DEPLOY.md`). The meter then
     reports over HTTPS from any WiFi network.
   - For local testing, leave `SERVER_URL` commented out. The ESP then
     finds a server running on the same WiFi automatically by broadcasting
     on UDP port 4001 (`DISCOVERY_PORT`), and rediscovers it whenever WiFi
     reconnects or reports keep failing.
4. **Tools → Board**, select your exact board (e.g. "NodeMCU 1.0" or your
   ESP32 model), select the right **Port**, and **Upload**.
5. Open the Serial Monitor (115200 baud) to watch it connect to WiFi and
   start reporting.

## Provisioning a device

Each household's meter authenticates with its own secret key — this is
what lets the server trust a reading actually came from that household's
sensor (and what makes billing off these readings safe).

1. Log into the admin panel → **Households** → expand the household this
   sensor belongs to.
2. Click **Generate device key**. The key is shown once — copy it into
   `config.h` as `DEVICE_KEY` immediately, then flash the device.
3. If a key is lost, leaked, or a device is replaced: click
   **Regenerate key** (immediately invalidates the old one) and reflash.
   **Revoke** clears the key entirely if a device is decommissioned.

## Calibration

The firmware only ever reports raw pulse counts — all the pulses→liters
math happens server-side using that household's **pulses-per-liter**
value (editable right next to the device key, defaults to 450, the
YF-S201's nominal spec). This means recalibrating never requires
reflashing hardware.

To calibrate precisely for your specific sensor:

1. Note the pulse count for a period, then run a known volume of water
   through the line (e.g. fill a 10-liter container from a tap fed by the
   metered line, or use the household's own tap for a timed volume).
2. Compare against what the admin dashboard shows for pulses/liters over
   that same window (visible in the household's live reading detail).
3. `actual_pulses_per_liter = pulses_counted / liters_measured`. Enter
   that value into the Calibration field and **Save**.

Sensor-to-sensor variance of ±10% from the nominal spec is normal for
low-cost hall-effect sensors — calibrating each one individually gets
noticeably more accurate billing than trusting the datasheet number.

## How this feeds real-time monitoring and billing

- Every report (`REPORT_INTERVAL_MS`, default 15s) updates that
  household's live reading and flow rate — visible immediately on the
  admin dashboard via a live push (no refresh needed).
- Sustained or spiking flow automatically raises **High Flow** / **Leak
  Detected** alerts in real time — independent of the monthly billing
  cycle, so a leak running overnight gets flagged that night, not at the
  next meter reading.
- When the admin runs **Generate Bills** for a period, it bills off each
  household's latest accumulated reading — same as it always has, just now
  fed by the live sensor instead of a manual entry.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Serial Monitor stuck on "Connecting to WiFi…" | Wrong SSID/password in `config.h`, or a 5GHz-only network (ESP8266/ESP32 need 2.4GHz). |
| `Looking for the server… no answer` | Server not running, on a different network than the ESP, or Windows Firewall is blocking inbound UDP 4001 — allow it (see Troubleshooting below). |
| `http.begin() failed` | Malformed `SERVER_URL`. It must start with `https://` (cloud) or `http://` (local). |
| HTTP 401 `Invalid device key` | Key was mistyped, or regenerated/revoked in the admin panel since flashing — re-provision and reflash. |
| HTTP 400 `pulses must be...` / `intervalMs must be...` | Shouldn't happen with the stock firmware; indicates a modified sketch sending malformed JSON. |
| Request times out / server unreachable | Check both are on the same network/VLAN, and that Windows Firewall allows inbound TCP 4000 and UDP 4001 (admin PowerShell: `New-NetFirewallRule -DisplayName "WaterSystem" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow` and the same with `-Protocol UDP -LocalPort 4001`). |
| Pulse count reads 0 even with water flowing | Check the signal wire is on an interrupt-capable pin, and flow direction matches the arrow on the sensor body. |
| Admin dashboard shows "Offline" despite the device running | It hasn't reported in the last 10 minutes — check Serial Monitor for repeated report failures. |
