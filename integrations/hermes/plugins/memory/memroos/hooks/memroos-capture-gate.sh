#!/usr/bin/env bash
# Stop/pre-compact structured capture. Every path is fail-open and exits zero.

set -u

# Every hook invocation must return a JSON object on stdout. Codex and Pi
# reject an empty stream with "hook returned invalid stop hook JSON output" and
# surface it as a failed Stop hook — the harness cannot tell "nothing to say"
# from "this crashed".
#
# The trap covers every exit path, including the early returns below, so a
# skip is as valid on the wire as a capture. This shipped as a local patch on
# one machine and was never committed, which is why that host worked while
# every host installing from this repo failed the same way. A fix that lives
# only on the box where it was written is a fix exactly once.
memroos_emit_hook_result() {
  printf '%s\n' '{"continue":true}'
}
trap memroos_emit_hook_result EXIT

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=memroos-hook-common.sh
source "$HOOK_DIR/memroos-hook-common.sh"

event="$(memroos_read_event)"
memroos_bind_event_identity "$event"
if ! memroos_resolve_hook_runner "$HOOK_DIR"; then
  memroos_record_receipt "capture-gate" "skip" "helper_unavailable" 0
  exit 0
fi
memroos_require_endpoint_and_credential "capture-gate" "skip" || exit 0

body="$(printf '%s' "$event" | "${MEMROOS_HOOK_RUNNER[@]}" capture 2>/dev/null || true)"
if [[ -z "$body" ]]; then
  memroos_record_receipt "capture-gate" "skip" "invalid_hook_payload" 0
  exit 0
fi

skip_reason="$(printf '%s' "$body" | "${MEMROOS_HOOK_RUNNER[@]}" skip-reason 2>/dev/null || true)"
if [[ -n "$skip_reason" ]]; then
  memroos_record_receipt "capture-gate" "skip" "$skip_reason" 0
  exit 0
fi

if memroos_post_json_status "${MEMROOS_BASE_URL%/}/api/agent-memory/capture" "$body" "3.5"; then
  memroos_record_receipt "capture-gate" "captured" "durable_receipt" "$MEMROOS_HTTP_DURATION_MS"
  exit 0
fi

# Failure is observable but never propagated to the harness.
#
# Two destinations, deliberately. agent-report files an issue a human can
# triage and accepts an agent key, an MCP bearer or an operator session — so a
# Pi or any other client can be heard without operator credentials.
# cron-health keeps feeding NOC Attention where an operator key exists.
# memroos_report_failure writes its own receipt saying whether the send landed,
# so "not reported" is a fact on disk rather than a silence.
#
# The receipt names the failure class and the measured duration. A 3.5 s
# timeout, a 403 and a 400 are three different problems; one warning that
# covered all of them hid which one a host actually had.
failure_code="$(memroos_http_failure_code "$MEMROOS_HTTP_STATUS" "$MEMROOS_HTTP_CURL_EXIT")"
app_error="$(printf '%s' "$MEMROOS_HTTP_RESPONSE" | "${MEMROOS_HOOK_RUNNER[@]}" error-code 2>/dev/null || true)"
memroos_record_receipt "capture-gate" "failure" "$failure_code" "$MEMROOS_HTTP_DURATION_MS"
warning="capture-gate failed open: ${failure_code#capture.}"
memroos_report_failure "$warning" "$failure_code" "$MEMROOS_HTTP_STATUS" "$MEMROOS_HTTP_DURATION_MS" "$MEMROOS_HTTP_CURL_EXIT" "$app_error"
memroos_post_noc_attention "$warning"
exit 0
