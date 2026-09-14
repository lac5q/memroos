---
title: "Hermes deleted-WAL persistence failure diagnosis"
description: "Live diagnosis of session_persistence_failed:deleted_wal on maeve-u1, with evidence and safe remediation."
publishedAt: "2026-09-14"
tags: [hermes, sqlite, wal, operations, incident]
keywords: [session_persistence_failed, deleted_wal, state.db, stale process, split-brain]
author: "Alba"
source_session: "01a09e81-83e8-7708-8acc-d5c0f8d921f7"
model: "gpt-5.6-sol"
sources:
  - "maeve-u1:/home/lac5q/.hermes/logs/agent.log"
  - "maeve-u1:/home/lac5q/.hermes/logs/gateway.log"
  - "maeve-u1:/home/lac5q/.hermes/logs/gateway-exit-diag.log"
  - "maeve-u1:/home/lac5q/.hermes/hermes-agent/hermes_state_dbfile.py"
  - "maeve-u1:systemctl --user status hermes-dashboard.service hermes-gateway.service"
  - "maeve-u1:lsof /home/lac5q/.hermes/state.db*"
derived_from: []
regen_prompt: "Reinspect maeve-u1 for Hermes state.db writers, deleted WAL holders, retired-WAL artifacts, diverted messages, code-generation mismatches, and database integrity; update this diagnosis with current evidence."
---

# Hermes deleted-WAL persistence failure diagnosis

## Incident

At `2026-09-14T06:00:56.282Z`, Hermes stopped a provider turn with `session_persistence_failed:deleted_wal`. This is a local SQLite session-store safety stop, not an OpenAI provider failure: a process observed that the `state.db-wal` pathname no longer referred to the WAL generation it had opened.

## Findings

- The active database is `/home/lac5q/.hermes/state.db` in WAL mode.
- A read-only `PRAGMA quick_check` returned `ok`; 345 sessions were readable. Disk and inode capacity were healthy (22% blocks, 6% inodes).
- Three long-lived Hermes processes concurrently held the same database and WAL: dashboard PID 282439 (started Sep 12 08:42), isolated serve PID 2400835 (started Sep 12 22:00), and gateway PID 2587160 (started Sep 13 22:44).
- The checkout changed from commit `b20cc5f787` to `08a2e7dbcc`. Logs repeatedly state that an older process was still booted on `b20cc5f787` while disk was at `08a2e7dbcc`.
- A `hermes update` process (PID 2404909) had remained alive for more than 25 hours, and a `hermes setup` process (PID 2576024) was suspended in job-control state `T`.
- At inspection time, no process still held an unlinked `state.db-wal` or `state.db-shm`; all observed holders referred to the current inodes. No adjacent `state.db.retired-wal-*` artifact and no recent diverted `pending_messages/pending-*.json` or `sessions/*.jsonl` fallback were found.
- A separate issue is flooding the gateway logs: Slack Socket Mode continuously returns `invalid_auth`. This is unrelated to the deleted-WAL stop but should be corrected or the Slack integration disabled.

## Root cause assessment

The immediate condition was a transient retired WAL generation. The most likely trigger is mixed-generation concurrency during/after the Hermes update: pre-update dashboard/serve processes stayed live while a new gateway and setup/update activity opened or rotated SQLite sidecars. The guard correctly failed closed instead of allowing a turn to write into an ambiguous WAL generation.

No evidence currently indicates corruption of the active database. Because no retired-WAL artifact exists, there is nothing to inspect or merge with `hermes sessions recover` from this occurrence.

## Safe remediation

1. Stop all Hermes writers together: gateway, dashboard, isolated `hermes serve`, cron/session writers, and the stale update/setup commands.
2. Confirm `lsof +L1` shows no deleted `state.db-wal`/`state.db-shm` holder and `lsof state.db*` shows no unexpected writer.
3. Do not delete or overwrite `state.db`, `state.db-wal`, or `state.db-shm`.
4. Restart only the current-code dashboard and gateway, then run a read-only integrity check and a test turn.
5. If a future occurrence creates `state.db.retired-wal-*/manifest.json`, inspect `main.mode`; run `hermes sessions recover --source <artifact>/state.db --inspect-only` only when mode is `copied`.
6. Refresh or disable the invalid Slack credentials to stop the reconnect storm.

## Prevention

Hermes update/setup should stop or explicitly reject all live state writers before changing runtime generations. Operationally, restart long-lived dashboard and isolated-serve processes immediately after an update and avoid running setup while gateway/dashboard/session writers remain active.
