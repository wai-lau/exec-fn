# tts-box — keep the home TTS upstream alive

These files run on the **home GPU box** (not the droplet, not in the repo's
container). They keep the Kokoro/Chatterbox TTS server up so `/hosaka` and the
`/tarot` reader voice stay online.

## The failure mode

The droplet reaches the TTS server over an SSH reverse tunnel
(`172.17.0.1:8123` on the droplet → the model server on this box). When the
model process dies, the tunnel's listening socket stays bound on the droplet, so
a connection **accepts then resets** (`Connection reset by peer`). A bound port
is therefore *not* liveness — only an actual HTTP response is. `/hosaka` shows
**"TTS server offline"** (see `/api/hosaka/health`). The fix is to bring the
model server back up here.

## The OTHER failure mode — tunnel can't rebind after a reboot

When this box reboots (e.g. WSL restart) the ssh client dies abruptly without a
clean disconnect. The droplet's sshd doesn't notice and keeps the old session's
`-R` bind on `172.17.0.1:8123`. When this box comes back, `hosaka-tunnel.service`
starts a new ssh, tries the same `-R` bind, the droplet refuses it
(`Error: remote port forwarding failed for listen port 8123`), ssh exits 255,
systemd respawns it — **permanent flap**, `/hosaka` dead.

Fixed on **both** sides by SSH keepalive:

- **Droplet** (`/etc/ssh/sshd_config.d/20-hosaka-keepalive.conf`, in `bootstrap.sh`):
  `ClientAliveInterval 30` + `ClientAliveCountMax 3` — sshd probes the idle
  tunnel and reaps the dead session in ~90s, freeing the port.
- **Home box** (`hosaka-tunnel.service`, Option C below): `ServerAliveInterval` +
  `ExitOnForwardFailure` — the client detects a dead droplet and exits cleanly,
  and stops holding a half-open tunnel while the port is still taken.

After both, a reboot self-heals within ~90s with no manual `kill`.

## Option C — the reverse tunnel itself (systemd user service)

```bash
cp hosaka-tunnel.service ~/.config/systemd/user/
# `wai-lau-tunnel` must be a Host alias in ~/.ssh/config
# (HostName wai-lau.net, User …, IdentityFile …). Then:
systemctl --user daemon-reload
systemctl --user enable --now hosaka-tunnel
loginctl enable-linger "$USER"   # survive logout / reboot
```

## Option A — systemd user service (primary, self-recovers a crash)

```bash
mkdir -p ~/.config/systemd/user
cp exec-fn-tts.service ~/.config/systemd/user/
# edit WorkingDirectory + ExecStart for your box, then:
systemctl --user daemon-reload
systemctl --user enable --now exec-fn-tts
loginctl enable-linger "$USER"   # survive logout / reboot
```

`Restart=always` brings the server back whenever it exits. That covers the
common case (process gone → port resets).

## Option B — watchdog (add on top; catches a HANG, not just a crash)

A process can stay alive but stop answering its port; `Restart=always` won't
notice. The watchdog probes the port and restarts when it goes quiet.

```bash
cp tts-watchdog.sh ~/.local/bin/ && chmod +x ~/.local/bin/tts-watchdog.sh
cp exec-fn-tts-watchdog.{service,timer} ~/.config/systemd/user/
# edit START_CMD in the .service, then:
systemctl --user daemon-reload
systemctl --user enable --now exec-fn-tts-watchdog.timer
```

Cron instead of the timer:

```cron
* * * * * START_CMD='REPLACE_WITH_START_CMD --port 8123' ~/.local/bin/tts-watchdog.sh
```

## Config knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `TTS_PORT` | `8123` | local port the model server listens on (matches the tunnel target) |
| `START_CMD` | *(unset)* | exact launch command — **required** by the watchdog |
| `TTS_WATCHDOG_LOG` | `~/.local/state/exec-fn-tts-watchdog.log` | watchdog log |

## Verify

```bash
curl -fsS http://127.0.0.1:8123/v1/voices >/dev/null && echo UP || echo DOWN
```

Then reload `/hosaka` on the droplet — status flips from "TTS server offline" to
"ready".
