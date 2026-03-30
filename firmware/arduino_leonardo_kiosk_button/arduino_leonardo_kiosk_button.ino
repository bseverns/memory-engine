/*
  Memory Engine Kiosk Button

  Board:
    Arduino Leonardo

  Wiring:
    - Momentary pushbutton between pin 2 and GND

  Behavior:
    - Short press: sends Space to advance the kiosk's primary action
    - Long press (>= 1600 ms): sends Escape to cancel/reset the kiosk session

  Why this shape:
    The kiosk already owns the interaction contract through keyboard shortcuts.
    The Leonardo acts as a tiny HID bridge so hands-free activation does not
    require a new browser API, daemon, or operator-side control path.
*/

#include <Keyboard.h>

const uint8_t BUTTON_PIN = 2;
const unsigned long DEBOUNCE_MS = 30;
const unsigned long HOLD_ESCAPE_MS = 1600;

bool lastReading = HIGH;
bool stableState = HIGH;
bool pressHandled = false;
unsigned long lastChangeMs = 0;
unsigned long pressStartedMs = 0;

void tapKey(uint8_t keycode) {
  Keyboard.press(keycode);
  delay(35);
  Keyboard.release(keycode);
}

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  Keyboard.begin();
}

void loop() {
  const unsigned long now = millis();
  const bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastReading) {
    lastChangeMs = now;
    lastReading = reading;
  }

  if ((now - lastChangeMs) < DEBOUNCE_MS) {
    return;
  }

  if (reading != stableState) {
    stableState = reading;
    if (stableState == LOW) {
      pressStartedMs = now;
      pressHandled = false;
      digitalWrite(LED_BUILTIN, HIGH);
    } else {
      if (!pressHandled) {
        tapKey(' ');
      }
      digitalWrite(LED_BUILTIN, LOW);
    }
  }

  if (stableState == LOW && !pressHandled && (now - pressStartedMs) >= HOLD_ESCAPE_MS) {
    tapKey(KEY_ESC);
    pressHandled = true;
    digitalWrite(LED_BUILTIN, LOW);
  }
}
