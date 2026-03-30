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

- primary momentary pushbutton between pin `2` and `GND`
- optional mode buttons between pins `3`, `4`, `5` and `GND`
- optional monitor-check button between pin `6` and `GND`

Behavior:

- pin `2` short press sends `Space`
- pin `2` long press sends `Escape`
- pin `3` sends `1`
- pin `4` sends `2`
- pin `5` sends `3`
- pin `6` sends `M`

In kiosk terms, that means:

- short press advances the current primary action
  - arm microphone
  - start countdown / recording
  - submit after a mode is selected
- long press cancels or resets the current kiosk session
- optional extra buttons can choose `ROOM`, `FOSSIL`, or `NOSAVE`
- optional monitor button can open or close the browser-side monitor check

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
7. If you wired the optional buttons, test `1`, `2`, `3`, and `M` as well.
8. Test one short press and one long press before public use.

## Kiosk Shortcut Contract

The Leonardo relies on the existing browser shortcut model:

- `Space` or `Enter`: advance the primary action
- `1`, `2`, `3`: choose `ROOM`, `FOSSIL`, or `NOSAVE`
- `M`: open or close monitor check
- `Escape`: cancel/reset

## Next Likely Expansion

If this path proves useful, the next clean extension is not a new API.
It is one of these:

- a footswitch enclosure using the same HID shortcut model
- stronger browser focus / reboot recovery notes for unattended HID use
- a documented browser-launch / focus checklist so kiosk clients recover from reboot more predictably
