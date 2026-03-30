/*
  Memory Engine Kiosk Button

  Board:
    Arduino Leonardo

  Wiring:
    - Primary momentary pushbutton between pin 2 and GND
    - Optional mode buttons between pins 3, 4, 5 and GND
    - Optional monitor-check button between pin 6 and GND

  Behavior:
    - Pin 2 short press: sends Space to advance the kiosk's primary action
    - Pin 2 long press (>= 1600 ms): sends Escape to cancel/reset the kiosk session
    - Pin 3: sends 1
    - Pin 4: sends 2
    - Pin 5: sends 3
    - Pin 6: sends M to open/close monitor check

  Why this shape:
    The kiosk already owns the interaction contract through keyboard shortcuts.
    The Leonardo acts as a tiny HID bridge so hands-free activation does not
    require a new browser API, daemon, or operator-side control path.
*/

#include <Keyboard.h>

const unsigned long DEBOUNCE_MS = 30;
const unsigned long HOLD_ESCAPE_MS = 1600;

struct ButtonConfig {
  uint8_t pin;
  uint8_t keycode;
  bool allowLongPressEscape;
};

struct ButtonState {
  bool lastReading;
  bool stableState;
  bool pressHandled;
  unsigned long lastChangeMs;
  unsigned long pressStartedMs;
};

ButtonConfig BUTTONS[] = {
  {2, ' ', true},
  {3, '1', false},
  {4, '2', false},
  {5, '3', false},
  {6, 'm', false},
};

ButtonState STATES[sizeof(BUTTONS) / sizeof(BUTTONS[0])];

void tapKey(uint8_t keycode) {
  Keyboard.press(keycode);
  delay(35);
  Keyboard.release(keycode);
}

void setup() {
  for (uint8_t index = 0; index < (sizeof(BUTTONS) / sizeof(BUTTONS[0])); index += 1) {
    pinMode(BUTTONS[index].pin, INPUT_PULLUP);
    STATES[index] = {HIGH, HIGH, false, 0, 0};
  }
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  Keyboard.begin();
}

void handlePrimaryButton(ButtonState &state, unsigned long now) {
  if (state.stableState == LOW && !state.pressHandled && (now - state.pressStartedMs) >= HOLD_ESCAPE_MS) {
    tapKey(KEY_ESC);
    state.pressHandled = true;
    digitalWrite(LED_BUILTIN, LOW);
  }
}

void handleButtonEvent(const ButtonConfig &config, ButtonState &state, unsigned long now) {
  const bool reading = digitalRead(config.pin);

  if (reading != state.lastReading) {
    state.lastChangeMs = now;
    state.lastReading = reading;
  }

  if ((now - state.lastChangeMs) < DEBOUNCE_MS) {
    if (config.allowLongPressEscape) {
      handlePrimaryButton(state, now);
    }
    return;
  }

  if (reading != state.stableState) {
    state.stableState = reading;
    if (state.stableState == LOW) {
      state.pressStartedMs = now;
      state.pressHandled = false;
      digitalWrite(LED_BUILTIN, HIGH);
      if (!config.allowLongPressEscape) {
        tapKey(config.keycode);
        state.pressHandled = true;
        digitalWrite(LED_BUILTIN, LOW);
      }
    } else {
      if (config.allowLongPressEscape && !state.pressHandled) {
        tapKey(config.keycode);
      }
      state.pressHandled = false;
      digitalWrite(LED_BUILTIN, LOW);
    }
  }

  if (config.allowLongPressEscape) {
    handlePrimaryButton(state, now);
  }
}

void loop() {
  const unsigned long now = millis();
  for (uint8_t index = 0; index < (sizeof(BUTTONS) / sizeof(BUTTONS[0])); index += 1) {
    handleButtonEvent(BUTTONS[index], STATES[index], now);
  }
}
