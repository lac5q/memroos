# MemRoOS Hermes memory provider

Opt-in dual-mode memory for Hermes Agent.

- **Default:** Hermes built-in MEMORY.md remains primary.
- **Observe mode:** mirrors bounded memory events to MemroOS without rewriting local memory.
- **Disable:** `hermes memory off`.

Requires Hermes `>=0.21`.

## Install

Install from the public repository and pin the release commit:

```bash
hermes plugins install "lac5q/memroos#integrations/hermes/plugins/memory/memroos" --ref <40-char release-sha>
hermes plugins enable memroos
hermes memory setup
```

The plugin is self-contained. It uses Hermes profile-scoped credentials when available and keeps receipts under the active Hermes home. Missing credentials, unavailable endpoints, timeouts, and capture failures fail open so they never block a session.

The provider registers the session-start memory brief and bounded capture hooks. It does not replace Hermes built-in memory files.
