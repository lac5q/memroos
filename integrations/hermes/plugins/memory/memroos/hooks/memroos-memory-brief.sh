#!/usr/bin/env bash
# Session-start prior-work pointer. It always exits zero: a memory miss or
# timeout must never block the harness session.

set -u
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=memroos-hook-common.sh
source "$HOOK_DIR/memroos-hook-common.sh"

event="$(memroos_read_event)"
memroos_bind_event_identity "$event"
if ! memroos_resolve_hook_runner "$HOOK_DIR"; then
  memroos_record_receipt "memory-brief" "miss" "helper_unavailable" 0
  exit 0
fi
memroos_require_endpoint_and_credential "memory-brief" "miss" || exit 0

request_body="$(printf '%s' "$event" | "${MEMROOS_HOOK_RUNNER[@]}" brief 2>/dev/null || true)"
if [[ -z "$request_body" ]]; then
  memroos_record_receipt "memory-brief" "miss" "invalid_hook_payload" 0
  exit 0
fi

response="$(memroos_post_json "${MEMROOS_BASE_URL%/}/api/memory/prior-work" "$request_body" "1.5" || true)"
if [[ -z "$response" ]]; then
  memroos_record_receipt "memory-brief" "miss" "timeout_or_unavailable" 1500
  exit 0
fi

digest="$(printf '%s' "$response" | "${MEMROOS_HOOK_RUNNER[@]}" digest 2>/dev/null || true)"
if [[ -n "$digest" ]]; then
  # stdout is the harness injection channel; no diagnostics are written here.
  printf '%s\n' "$digest"
  memroos_record_receipt "memory-brief" "hit" "pointer_digest" 0
else
  memroos_record_receipt "memory-brief" "miss" "invalid_probe_response" 0
fi
# HARDREPORT-03/04: confirm this agent can still report a problem, and deliver
# anything queued from a previous outage.
#
# This block used to sit BELOW the `exit 0` above, so it had never once run --
# a startup check that silently does nothing is worse than no check, because
# the receipt it would have written is the thing an operator looks for.
#
# Backgrounded and silenced: session start must not wait on the network, and a
# dead report path must not also break the session. The receipt is the record.
#
# Fully detached (stdin, stdout and stderr all redirected): a harness that reads
# this hook through captured pipes would otherwise wait on the probe too, and
# time the brief out after the hit receipt is already on disk.
report_check="$HOOK_DIR/memroos-check-report-path.py"
python_bin="$(command -v "${MEMROOS_PYTHON_BIN:-python3}" 2>/dev/null || true)"
if [[ -n "$python_bin" && -f "$report_check" ]]; then
  (
    if "$python_bin" "$report_check" >/dev/null 2>&1; then
      memroos_record_receipt "report-path" "ok" "can_report" 0
    else
      memroos_record_receipt "report-path" "failure" "cannot_report" 0
    fi
  ) </dev/null >/dev/null 2>&1 &
fi

exit 0
