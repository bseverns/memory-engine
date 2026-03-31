# Operator Drill Card

Use this as the ninety-second recovery card when the author is not standing
next to the machine.

## If The Kiosk Looks Dead

1. Check that Chromium is frontmost on `/kiosk/`.
2. Dismiss any restore bubble, permission chip, or visible browser chrome.
3. Press `Space` on a normal keyboard.
4. If the keyboard works, the Leonardo path is probably fine too.
5. If not, relaunch with `./scripts/browser_kiosk.sh --role kiosk --base-url ...`.

## If The Room Is Silent

1. Open `/ops/`.
2. Check whether playback is paused or maintenance mode is on.
3. Check whether the node says `degraded` or `broken`.
4. Open `/room/` and confirm the playback surface is still loaded.
5. If needed, restart the room browser with `./scripts/browser_kiosk.sh --role room --base-url ...`.

## If The Mic Path Seems Wrong

1. Open `/ops/`.
2. Run `Play output tone`.
3. Run `Start live monitor` with closed headphones or very low speaker level.
4. Say: "Room Memory check. One quiet line. One normal line. One clap."
5. If there is no signal, check browser mic permission and the OS input device.

## If Something In The Archive Needs To Leave Right Now

1. Open `/ops/`.
2. Find the memory in the active deployment stack.
3. Use `Remove from stack`.
4. Confirm the action.
5. The stack closes the gap automatically and the action is audited.

## If `/ops/` Says Degraded

1. Read the first warning card.
2. Check `/healthz`.
3. Check `/readyz`.
4. Run `./scripts/status.sh`.
5. If needed, use `./scripts/support_bundle.sh` before changing too much.

## If Storage Looks Critical

1. Open `/ops/`.
2. Confirm the warning is really storage and not pool balance.
3. Run `./scripts/backup.sh`.
4. Move old support bundles or copied exports off-machine if they are just sitting on the host.
5. Do not delete live MinIO or Postgres data by hand unless you are already inside a restore or migration procedure.

## If A Restore Must Happen

1. Find the newest known-good backup.
2. If time allows, rehearse on a throwaway target before touching the live node.
3. Run `./scripts/restore.sh --from backups/...`.
4. Re-open `/ops/`, `/kiosk/`, and `/room/`.
5. Make one short test recording before reopening to the public.

## Before Opening To The Public

1. `/ops/` signs in and shows an understood state.
2. Kiosk records one short test.
3. Room plays back.
4. Operator monitor check passes.
5. One steward knows where this card lives.
