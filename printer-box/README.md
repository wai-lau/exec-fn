# printer-box — reverse-tunnel the ELEGOO printer to the droplet

Runs on the **home box** (the WSL workstation on the same LAN as the printer),
not on the droplet. It is what makes `/printer` on wai-lau.net work "when the
printer is online and this computer is on".

## What it does

`printer-tunnel.service` is a systemd **user** unit holding one `ssh -NT` with
three `-R` forwards, straight from the droplet's docker bridge to the printer's
LAN address (nothing listens on this box):

| droplet (`172.17.0.1`) | printer (`192.168.2.25`) | what |
|---|---|---|
| `:8126` | `:80` | Angular SPA shell, hashed assets, i18n, file upload/download |
| `:8127` | `:3030` | SDCP control websocket (`/websocket`) — status, temps, moves, prints |
| `:8128` | `:3031` | MJPEG camera stream (`/video`) |

The exec-fn container reaches them as `PRINTER_UPSTREAM` /
`PRINTER_WS_UPSTREAM` / `PRINTER_VIDEO_UPSTREAM` (`api/routes_printer.py`).

## Install (once, as wai)

```bash
# 1. ssh alias — same key as the hosaka/emet tunnels, its own name:
#    add `printer-tunnel` to the `Host wai-lau-tunnel emet-tunnel` line in ~/.ssh/config
# 2. the unit
cp printer-box/printer-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now printer-tunnel.service
loginctl enable-linger "$USER"   # survive logout / reboot (already on for hosaka)
```

Droplet side needs nothing new: `GatewayPorts clientspecified` + the keepalive
sshd config from `bootstrap.sh` already cover any `-R` port, and the tunnel
key's `authorized_keys` entry is forward-only (no `permitlisten` clamp).

## Failure modes (same as hosaka, see `tts-box/README.md`)

- **Printer off, box on** — the three ports stay bound on the droplet; a
  connect *accepts then resets*. `/api/printer/health` treats only a real HTTP
  answer as online, so `/printer` shows "printer offline" and remounts the UI
  by itself when the printer answers again.
- **Box off / asleep** — sshd's `ClientAliveInterval` reaps the dead session in
  ~90s and frees the ports; the unit's `Restart=always` + `ExitOnForwardFailure`
  rebinds cleanly on the next boot.

## Verify

```bash
systemctl --user status printer-tunnel
curl -fsS http://192.168.2.25/ >/dev/null && echo PRINTER UP || echo PRINTER DOWN
```

Then open `https://wai-lau.net/printer` (admin login).
