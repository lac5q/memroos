---
title: "Hermes Desktop main-mac to maeve-u1 failure diagnosis"
description: "Diagnosis of simultaneous conversation initialization and plugin repository probe failures in Hermes Desktop v0.21.3."
publishedAt: "2026-09-15"
tags: [hermes, desktop, maeve-u1, main-mac, diagnostics]
keywords: [opencode-zen, OPENCODE_ZEN_API_KEY, git ENOENT, remote backend, composer state]
author: "Pi coding agent"
source_session: "unknown"
model: "gpt-5.6-sol"
sources:
  - "live-system:maeve-u1"
  - "repo:NousResearch/hermes-agent apps/desktop"
derived_from: []
regen_prompt: "Re-check the Hermes Desktop connection from main-mac to maeve-u1, provider selection state, local Git resolution, backend health, and plugin repository reachability."
---

# Hermes Desktop main-mac to maeve-u1 failure diagnosis

## Findings

The Desktop-to-maeve-u1 connection itself was healthy. Two active remote `hermes serve --isolated` backends reported `HERMES_BACKEND_READY`, and the default backend identified its configured provider as `openai-codex`.

The conversation failure was caused by a client-supplied, sticky composer selection for provider `opencode-zen`. Maeve-u1 has no `OPENCODE_ZEN_API_KEY`, so agent initialization correctly rejected that override. Hermes Desktop intentionally persists composer model/provider selection in renderer localStorage per connection/profile, and new chats keep that manual selection. The server default remained `gpt-5.6-sol` through `openai-codex` and worked in a direct smoke test (`Reply exactly OK.` returned `OK`).

The plugin failure was a separate local-Desktop issue. The error `spawn /opt/homebrew/bin/git ENOENT` is Node/Electron child-process syntax. Hermes Desktop probes plugin repositories on the Desktop machine before it sends the agent-plugin install RPC to the remote backend. Therefore `/opt/homebrew/bin/git` refers to main-mac, not maeve-u1. On maeve-u1, Git is healthy at `/usr/bin/git`, and `git ls-remote https://github.com/Adolanium/hermes-tailscale.git` resolved the reviewed commit `6dad1d5aac443a196f7ba83736a1f4c9e3a75048`.

## Remediation

1. In the maeve-u1/default profile Desktop window, use the composer model picker to select a configured provider/model (the server default is OpenAI Codex / `gpt-5.6-sol`). A new session alone does not clear a manual composer override.
2. Fully quit and relaunch Hermes Desktop on main-mac so its cached Git binary is resolved again.
3. If plugin probing still reports the same path, check or restore Git on main-mac: `ls -l /opt/homebrew/bin/git /usr/bin/git`, `command -v git`, and `git --version`. Reinstall/link Homebrew Git if `/opt/homebrew/bin/git` is expected, or ensure the GUI app can resolve `/usr/bin/git`.
4. No `OPENCODE_ZEN_API_KEY` should be added unless OpenCode Zen is intentionally the desired provider.

## Verification evidence

- Hermes version: client/backend 0.21.3.
- `hermes doctor`: OpenAI Codex logged in; Git available; configuration current.
- Direct maeve-u1 conversation smoke test succeeded.
- Default `~/.hermes/config.yaml`: provider `openai-codex`, model `gpt-5.6-sol`.
- Main-mac inspection over SSH was unavailable because SSH authentication was rejected; its local Git state requires an interactive/local check.
