---
title: "Hermes cron model routing: lowest useful Codex tier"
description: "Jev-assisted routing decision and deployed fleet policy for six Hermes cron jobs."
publishedAt: "2026-09-20"
tags: [hermes, cron, openai-codex, typesafe, jev, cost-optimization]
keywords: [Hermes cron.model, gpt-5.6-luna, reasoning effort, Jev routing]
author: "Alba [bot]"
source_session: "01a0bf78-aec5-7c8f-a625-118806a6fc0f"
model: "gpt-5.6-sol"
sources:
  - "https://docs.typesafe.ai/llms.txt"
  - "https://docs.typesafe.ai/api.md"
  - "https://docs.typesafe.ai/primitives/choice.md"
  - "https://docs.typesafe.ai/confidence.md"
  - "https://docs.typesafe.ai/patterns/confidence-routing.md"
  - "local:/home/lac5q/.hermes/hermes-agent/website/docs/user-guide/features/cron.md"
  - "local:/home/lac5q/.hermes/cron/jobs.json"
derived_from: []
regen_prompt: "Re-inventory every Hermes cron job, classify each with Jev for the lowest sufficient Codex tier and risk, then verify the deployed cron defaults and representative runs."
---

# Hermes cron model routing: lowest useful Codex tier

## Decision

Use `openai-codex/gpt-5.6-luna` as the fleet-wide cron default. Use `low` reasoning by default. Raise reasoning per job only when the task's ambiguity justifies it; the current trending-audio research digest uses `medium`.

This policy is persisted on the default Hermes profile and all 43 named profiles:

```yaml
cron:
  model: gpt-5.6-luna
  model_provider: openai-codex
agent:
  reasoning_overrides:
    gpt-5.6-luna: low
```

Existing jobs are explicitly pinned so stale creation snapshots cannot override the fleet policy.

## Jev routing method

A single batched `jev-latest` request evaluated all six jobs. Each job received:

1. A `Choice` among `no_llm`, `luna_minimal`, `luna_low`, `luna_medium`, and `sol_low`.
2. A `Score` for the consequence of a materially wrong result.

Code retained control of the final policy. Jev supplied typed semantic judgments and probabilities. This follows TypeSafe's recommended pattern: deterministic control flow in code, narrow independent judgments in one request, and confidence-aware escalation.

Jev selected `luna_low` for all six jobs. Route confidence ranged from 0.49 to 0.96. The trending-audio digest had the least concentrated result (`luna_low` 0.60, `luna_medium` 0.40), so it was conservatively raised to `medium`. The remaining five jobs use `low`.

## Applied routing

| Job | Model | Reasoning |
|---|---|---|
| nightly-security-scan | gpt-5.6-luna | low |
| fleet-daily-pulse | gpt-5.6-luna | low |
| weekly-hermes-bot-practices | gpt-5.6-luna | low |
| popsmiths-inbox-watch | gpt-5.6-luna | low |
| turnedwizard-inbox-watch | gpt-5.6-luna | low |
| trending-sounds-digest | gpt-5.6-luna | medium |

The two inbox jobs only inspect and draft; they cannot send, refund, or publish. That keeps the consequence of a weak draft reviewable and supports Luna-low rather than a larger model.

## Verification

- Direct Codex smoke test: `gpt-5.6-luna` with low reasoning returned `LUNA_OK`.
- Fleet policy audit: all 44 profiles had `cron.model=gpt-5.6-luna`, `cron.model_provider=openai-codex`, and the Luna reasoning override set to `low`.
- All six existing jobs had explicit OpenAI Codex/Luna pins and reasoning pins.
- Four formerly failing jobs were run directly after migration and completed successfully:
  - fleet-daily-pulse
  - weekly-hermes-bot-practices
  - popsmiths-inbox-watch
  - turnedwizard-inbox-watch
- Final `hermes cron doctor`: no issues across six active jobs.

One earlier fleet-daily-pulse test was interrupted by the invoking shell's timeout and recorded `unknown`; a subsequent full run completed successfully. No unresolved cron failure remains.
