# Ubuntu Appliance Recipe

Use this when you want the current reference host posture written down as a
repeatable recipe instead of a pile of remembered shell steps.

Scope:

- reference host image: `Ubuntu Server 24.04.4 LTS`
- one node
- one trusted steward group
- Docker Compose as the supported runtime

This recipe covers the host machine that runs the stack itself, not the
separate touchscreen or playback browser clients.

## Before You Start

- Install Docker Engine and the Docker Compose plugin.
- Clone this repo onto the host.
- Make sure the service user owns the repo checkout and can run `docker compose`.
- Decide which SSH port should stay open before enabling the firewall.

## One-Command Host Hardening

From the repo root on the Ubuntu host:

```bash
sudo ./scripts/ubuntu_appliance.sh
```

What it does:

- enables `ufw`
- allows `22/tcp`, `80/tcp`, and `443/tcp`
- writes `/etc/systemd/system/memory-engine-compose.service`
- enables Docker and the compose service for restart-on-boot

Useful variants:

```bash
sudo ./scripts/ubuntu_appliance.sh --ssh-port 2222
sudo ./scripts/ubuntu_appliance.sh --service-user kiosk --start-now
sudo ./scripts/ubuntu_appliance.sh --skip-firewall
```

If you use a different SSH port, set it here before leaving the machine.

## First Bring-Up

Stamp out development defaults and deploy:

```bash
./scripts/first_boot.sh --public-host memory.example.com --deploy
```

Or, if DNS is not ready yet:

```bash
./scripts/first_boot.sh --public-host 203.0.113.10 --tls internal --deploy
```

After deploy:

```bash
./scripts/status.sh
./scripts/doctor.sh
```

Then open `/ops/` and confirm:

- the node is `ready` or in an understood `degraded` state
- no critical storage warning is present
- no unexpected pool warning is present

## What Restart-On-Boot Means Here

The systemd unit is intentionally narrow:

- it runs `docker compose up -d --remove-orphans` from this repo checkout
- it leaves shutdown behavior explicit through `docker compose down`
- it does not try to update code, rotate secrets, or change `.env`

That keeps boot predictable. Updates still happen through the normal steward
path:

```bash
./scripts/update.sh --public-host memory.example.com
```

## Ubuntu Host Checks

After any reboot, verify:

```bash
systemctl status memory-engine-compose.service --no-pager
sudo ufw status
docker compose ps
```

If the compose service did not come back:

1. check that the repo path in the unit still exists
2. check that the configured service user can run `docker compose`
3. inspect `journalctl -u memory-engine-compose.service -n 80 --no-pager`

## Browser Client Reminder

This host recipe does not replace kiosk-browser setup on dedicated client
machines. For those machines:

- use [installation-checklist.md](./installation-checklist.md)
- launch browsers through `./scripts/browser_kiosk.sh --role kiosk|room|ops --base-url ...`
- keep Chromium restore prompts and visible browser chrome out of the recovery path

## When To Change This Recipe

Change it only when one of these is true:

- the reference host image changes away from `Ubuntu Server 24.04.4 LTS`
- the supported runtime changes away from Docker Compose
- the firewall posture or boot service needs to open materially different ports or services
