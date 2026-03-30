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

## Focus And Reboot Recovery

The Leonardo path is only as reliable as the browser focus posture on the kiosk
machine.

The practical failure mode is simple:

- the board still sends `Space`, `Escape`, `1`, `2`, `3`, or `M`
- but Chromium is no longer the active focused surface
- so the kiosk appears dead even though the button is fine

Use this recovery posture:

- launch the recorder with `./scripts/browser_kiosk.sh --role kiosk --base-url ...`
- disable crash-restore, profile-first-run, and session-restore prompts at the OS/browser level
- after every reboot, verify `/kiosk/` is visibly frontmost and accepts one keyboard `Space`
- if a restore bubble, permission prompt, or browser chrome has stolen focus, clear that first before debugging the Leonardo
- keep a fallback USB keyboard nearby so a steward can press `Escape`, reload, or refocus Chromium without opening the enclosure

If Leonardo input suddenly stops during service, assume focus loss before
assuming firmware failure.

## Operator Monitor Check

The participant-facing monitor check on `/kiosk/` stays intentionally shallow:
it only plays an output tone.

The deeper check now lives on `/ops/`:

- `Play output tone` confirms the operator machine's current output path
- `Start live monitor` requests the microphone and plays it through locally in
  the steward browser
- this does not save, stream, or archive anything

Use headphones or very low speaker gain before enabling live monitor, or the
operator machine can feed back immediately.

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
- richer operator-side monitor material such as a spoken routing sample
- a documented browser-launch / focus checklist per OS image so kiosk clients recover from reboot more predictably
