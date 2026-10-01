// Flow sensor bench test — Arduino Mega 2560
// ────────────────────────────────────────────────────────────
// Standalone sanity check, no WiFi, no server. Wire the sensor up, run
// this, watch the Serial Monitor, and confirm you get sane numbers before
// moving to the real esp_water_meter firmware (../esp_water_meter/) for
// the WiFi-connected version that reports into the water system.
//
// It prints, once a second:
//   - pulses seen in the last second
//   - rotation speed in RPM (revolutions per minute)
//   - running total pulse count since power-on/reset
//
// Wiring:
//   Flow sensor VCC (red)     -> Mega 5V
//   Flow sensor GND (black)   -> Mega GND
//   Flow sensor signal (yellow) -> Mega pin 2 (INT4) — see PULSE_PIN below
//
// The Mega runs its I/O at 5V natively, same as most hall-effect flow
// sensors' native output level, so unlike ESP8266/ESP32 there's no logic-
// level mismatch to worry about here — a direct wire from signal to
// PULSE_PIN is fine for a standard 5V sensor like the YF-S201.
//
// Any digital pin with interrupt support works: on the Mega that's
// 2, 3, 18, 19, 20, 21 (mapped to INT4, INT5, INT3, INT2, INT1, INT0
// respectively — note this numbering is reversed from an Uno, where pin 2
// is INT0). digitalPinToInterrupt() below resolves this automatically, so
// it's only relevant if you're cross-checking against the ATmega2560
// datasheet. Pin 2 is used since it's the most common silkscreen-labeled
// choice for this kind of sensor.

const uint8_t PULSE_PIN = 2;

// How many pulses the sensor produces per full revolution of its internal
// wheel/turbine. A simple single-magnet hall-effect module is 1
// pulse/revolution; multi-magnet paddlewheel flow sensors like the
// YF-S201 report several per revolution (check the datasheet, or count
// pulses for one manually-turned revolution to find out). Left at 1 by
// default: the raw "pulses" and "totalPulses" columns are accurate no
// matter what this is set to — only the "rpm" column depends on it.
const float PULSES_PER_REVOLUTION = 1.0;

volatile unsigned long pulseCount = 0;
unsigned long lastReportMs = 0;
unsigned long totalPulses = 0;

void pulseISR() {
  pulseCount++;
}

void setup() {
  // The Mega's Serial is a hardware UART through an onboard USB-serial
  // chip, not native USB CDC, so it's ready as soon as begin() returns —
  // no "wait for the port to open" loop needed here (that idiom is for
  // native-USB boards like the Leonardo/Micro/Due).
  Serial.begin(115200);

  pinMode(PULSE_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PULSE_PIN), pulseISR, FALLING);

  Serial.println(F("Flow sensor bench test — Arduino Mega"));
  Serial.println(F("Spin the sensor wheel (or run water through it) and watch the readings below."));
  Serial.println(F("Nothing changing? Check wiring, or try jumpering the signal pin to GND by hand."));
  Serial.println();

  lastReportMs = millis();
}

void loop() {
  unsigned long now = millis();
  if (now - lastReportMs < 1000) return; // report once a second

  noInterrupts();
  unsigned long pulses = pulseCount;
  pulseCount = 0;
  interrupts();

  unsigned long elapsedMs = now - lastReportMs;
  lastReportMs = now;
  totalPulses += pulses;

  float revolutions = pulses / PULSES_PER_REVOLUTION;
  float rpm = revolutions / (elapsedMs / 60000.0);

  Serial.print(F("pulses="));
  Serial.print(pulses);
  Serial.print(F("  rpm="));
  Serial.print(rpm, 1);
  Serial.print(F("  totalPulses="));
  Serial.println(totalPulses);
}
