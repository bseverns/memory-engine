# Hands-Free Controls

This repo now includes a first hardware path for the open "hands-free control"
bucket: a tiny Arduino Leonardo sketch that acts as a USB keyboard trigger for
`/kiosk/`.

It is intentionally small.
The hardware does not get its own API.
It does not need a background daemon.
It uses the kiosk's existing keyboard shortcut contract.

## Current Leonardo Path

Firmware:

- `firmware/arduino_leonardo_kiosk_button/arduino_leonardo_kiosk_button.ino`

Board:

- Arduino Leonardo

Wiring:

- one normally-open momentary pushbutton between pin `2` and `GND`

Behavior:

- short press sends `Space`
- long press sends `Escape`

In kiosk terms, that means:

- short press advances the current primary action
  - arm microphone
  - start countdown / recording
  - submit after a mode is selected
- long press cancels or resets the current kiosk session

This makes the Leonardo path useful without introducing a second behavior model.

## Why Leonardo

The Leonardo presents itself as a native USB HID keyboard.
That means the kiosk machine can treat it like a simple keyboard button with no
host-side bridge process.

An Arduino Uno is still possible, but it would need extra host-side glue
because it does not natively behave as a USB keyboard.
For this repo, Leonardo is the cleaner appliance posture.

## Upload Steps

1. Open `firmware/arduino_leonardo_kiosk_button/arduino_leonardo_kiosk_button.ino` in the Arduino IDE.
2. Select the board `Arduino Leonardo`.
3. Select the correct port.
4. Upload the sketch.
5. Plug the Leonardo into the kiosk machine after upload is complete.
6. Focus the browser on `/kiosk/`.
7. Test one short press and one long press before public use.

## Kiosk Shortcut Contract

The Leonardo relies on the existing browser shortcut model:

- `Space` or `Enter`: advance the primary action
- `1`, `2`, `3`: choose `ROOM`, `FOSSIL`, or `NOSAVE`
- `Escape`: cancel/reset

Current limitation:

- the one-button Leonardo path covers the main start/advance/reset path only
- mode selection still assumes touch, mouse, or a conventional keyboard

## Next Likely Expansion

If this path proves useful, the next clean extension is not a new API.
It is one of these:

- a two- or three-button Leonardo layout that can send `1`, `2`, `3`
- a footswitch enclosure using the same HID shortcut model
- a documented browser-launch / focus checklist so kiosk clients recover from reboot more predictably
