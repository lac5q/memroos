---
title: "Maeve-u1 WSL reboot resilience hardening"
description: "Operational record of Windows-triggered WSL keepalive preparation, Linux service recovery, Buzz restoration, and SSH validation on maeve-u1."
publishedAt: "2026-09-23"
tags: [operations, maeve-u1, wsl, windows, ssh, buzz]
keywords: [WSL autostart, Windows Task Scheduler, systemd, Tailscale SSH, Buzz relay]
author: "Alba [bot]"
source_session: "01a0ca51-766f-702b-8dc5-f2e507e30e01"
model: "gpt-5.6-sol"
sources:
  - "host:maeve-u1"
  - "systemd:local-state-2026-09-23"
  - "tailscale:local-status-2026-09-23"
  - "docker:local-state-2026-09-23"
derived_from: []
regen_prompt: "Re-audit maeve-u1 after a Windows reboot: verify the Windows Maeve-WSL-Keepalive task, WSL keepalive process, enabled system and user services, Buzz health endpoints, and SSH over the Tailscale address."
---

# Maeve-u1 WSL reboot resilience hardening

## Outcome

The Ubuntu WSL distro already uses systemd. Docker, Tailscale, OpenSSH, the Buzz stack, the Cloudflare tunnel, and the main lingering user services are enabled for Linux boot. User lingering is enabled for `lac5q`.

Two host-side artifacts were added:

- `/home/lac5q/bin/wsl-keepalive` — a long-lived, signal-safe process that prevents the WSL distro from becoming idle after Windows starts it.
- `/home/lac5q/install-maeve-wsl-autostart.ps1` — an idempotent elevated Windows installer for a `Maeve-WSL-Keepalive` scheduled task. It uses startup and logon triggers, the current Windows user's WSL registration through S4U, unlimited execution time, and one-minute failure retries.

The PowerShell installer still requires one elevated execution from Windows because this WSL session has no Windows executable interop or mounted Windows drive. The command is:

```powershell
powershell -ExecutionPolicy Bypass -File "\\wsl.localhost\Ubuntu\home\lac5q\install-maeve-wsl-autostart.ps1"
```

## Service recovery

Buzz was in a 30-second restart loop because its pinned MinIO tags no longer existed locally under the expected tag names and the upstream pulls were denied. Existing cached images were safely retagged to the compose-pinned names. The next automatic systemd retry converged successfully.

Verified afterward:

- `buzz-stack.service`: active/success
- relay, Postgres, Redis, and MinIO containers: healthy
- `https://buzz.epiloguecapital.com/_readiness`: ready
- `https://buzz.epiloguecapital.com/_liveness`: ok

The Factory Droid user service was also in a hot failure loop because remote relay configuration cannot be resolved. Its policy was changed from a five-second unconditional restart to `Restart=on-failure`, `RestartSec=5min`, with a three-attempt-per-30-minute start limit. This preserves recovery without sustained CPU churn.

## SSH validation

OpenSSH and its socket are enabled and active, listening on IPv4 and IPv6 port 22. Tailscale is running with Tailscale SSH enabled and shields down. The tailnet address is `100.109.19.110`; TCP port 22 is reachable there and returns the host's RSA, ECDSA, and ED25519 keys.

A full remote authenticated shell was not proven from this session: local loopback had no matching client key, and the attempted hop through another tailnet node was rejected by that node's Tailscale SSH ACL. Transport, daemon, persistence, and host-key presentation are healthy.

## Follow-up verification

After installing the Windows scheduled task, reboot Windows and run:

```powershell
Get-ScheduledTask -TaskName Maeve-WSL-Keepalive
Get-ScheduledTaskInfo -TaskName Maeve-WSL-Keepalive
wsl.exe -d Ubuntu -- systemctl is-system-running
ssh lac5q@100.109.19.110
```
