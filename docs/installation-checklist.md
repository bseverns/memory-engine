# Installation Checklist

Use this checklist when turning a development node into a dedicated kiosk installation. It is written for the practical first deployment pass: one trusted operator, one kiosk device, one microphone, one playback output.

## Hardware

- Choose a kiosk device that can keep Chromium running reliably for long sessions. A Raspberry Pi 3 class device is the minimum posture this repo assumes.
- Confirm the device has stable power. If brownouts are possible, use a better supply before troubleshooting software.
- Attach the USB microphone directly if possible. If you need a hub, use a powered one.
- Attach the speaker, amplifier, or monitor output that will carry the room loop.
- Label the microphone and playback cables so a steward can reconnect them after transport or cleaning.
- If the kiosk is touch-first, verify the enclosure does not force precise taps on small browser chrome.
- If the kiosk relies on keyboard shortcuts for setup or fallback, keep a small keyboard available on site.

## Network And URL

- Decide whether the kiosk will record through `localhost`, a real `https://` domain, or a trusted internal-TLS IP setup.
- Do not expect remote plain `http://IP/...` recording to work. Browsers usually block microphone capture there.
- If you deploy before DNS exists, make sure the kiosk device trusts the internal CA before expecting microphone capture over HTTPS to an IP address.
- Run `./scripts/doctor.sh` after writing `.env` so the browser/TLS posture is checked before install day.

## Browser Kiosk Mode

- Configure Chromium to open directly to `/kiosk/`.
- Hide browser chrome, tabs, and address bar. The participant path should not depend on visible browser controls.
- Disable sleep or screen blanking during open hours.
- Disable first-run prompts, update nags, restore-session prompts, and crash restore prompts.
- Disable pinch zoom or browser gestures if they can reveal browser UI in the enclosure.
- Verify that reloading the page returns to a clean idle kiosk state.
- Verify that the browser has persistent permission to use the chosen microphone on that URL.

## Audio Device Selection

- In the OS audio settings, confirm the intended USB microphone is the default input device.
- In Chromium site settings, confirm the same microphone is selected for the kiosk URL.
- Confirm the playback device is the intended speaker or audio interface, not HDMI or an internal monitor speaker by accident.
- Open `/kiosk/`, arm the microphone, and watch the meter while speaking at normal distance.
- Make one test recording and confirm the preview plays through the intended output device.
- Start the room loop and confirm ambient playback is audible at the intended room level.
- If the input level is too low, fix gain or microphone placement in the OS or hardware before changing app code.

## Auto-Start On Boot

- Configure the machine to log into the kiosk user automatically after boot.
- Configure Docker and the compose stack to start automatically on boot.
- Configure Chromium kiosk mode to launch automatically after login.
- Ensure the browser launch waits until the network stack and display are ready, or it may open to a blank or unreachable page.
- Reboot once as a real test. Do not consider auto-start complete until the device returns to `/kiosk/` without operator intervention.

## Operator Acceptance Pass

- Run `./scripts/check.sh`.
- Run `./scripts/doctor.sh`.
- Run `./scripts/status.sh`.
- Open `/ops/` and confirm the node reports `ready` or an understood `degraded` state.
- Confirm there are no critical storage warnings.
- Confirm there are no unexpected pool warnings before public use.
- Test one full participant flow: arm, record, review, choose a mode, receive a receipt if applicable.
- Test one restart cycle: reboot or restart the kiosk path and confirm the system returns to the idle attract state.

## Steward Handoff

- Leave the revocation and maintenance notes from `docs/maintenance.md` with the steward.
- Leave one-page instructions for how to power-cycle the kiosk safely.
- Document which microphone and speaker devices are the intended defaults on that machine.
- Record the exact public host or kiosk URL used on site.
