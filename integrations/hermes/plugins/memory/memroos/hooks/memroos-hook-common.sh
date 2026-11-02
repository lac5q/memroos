#!/usr/bin/env bash
# Shared fail-open helpers for the repo-shipped session hooks.
# Diagnostics go to receipts/stderr; hook stdout is reserved for the brief digest.

set -u

MEMROOS_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMROOS_HOOK_ROOT="${MEMROOS_HOOK_ROOT:-${HOME:-/tmp}/.memroos}"
MEMROOS_HOOK_RECEIPT_DIR="${MEMROOS_HOOK_RECEIPT_DIR:-$MEMROOS_HOOK_ROOT/hook-receipts}"
MEMROOS_HOOK_RECEIPT_FILE="${MEMROOS_HOOK_RECEIPT_FILE:-$MEMROOS_HOOK_RECEIPT_DIR/session-hooks.jsonl}"
# Find this host's credential before deciding where to post.
#
# Without this the hooks read only the process environment, so a harness that
# does not export MEMROOS_AGENT_API_KEY produced a "no credential" receipt on a
# machine that had a working key on disk -- which is exactly what a fleet host
# did, silently, for as long as anyone had been looking.
#
# Sourced from two locations because the hooks run both from a checkout and
# from ~/.memroos/hooks where the installer places a copy alongside them.
#
# Under MEMROOS_CREDENTIAL_SCOPE=hermes-profile the parent (the Hermes plugin)
# has already resolved the active profile's key through Hermes' secret scope.
# Falling through to the host-wide on-disk key here would post one profile's
# memories as some other agent, so the loader is skipped: an already-set key
# wins and a keyless profile fails open with a credential_unavailable receipt.
MEMROOS_PROFILE_SCOPED=0
[[ "${MEMROOS_CREDENTIAL_SCOPE:-}" == "hermes-profile" ]] && MEMROOS_PROFILE_SCOPED=1
if [[ "$MEMROOS_PROFILE_SCOPED" -eq 0 ]]; then
  for _memroos_cred_lib in \
    "$MEMROOS_HOOK_DIR/memroos-agent-credentials.sh" \
    "$MEMROOS_HOOK_DIR/../memroos-agent-credentials.sh"; do
    if [[ -r "$_memroos_cred_lib" ]]; then
      # shellcheck source=../memroos-agent-credentials.sh
      source "$_memroos_cred_lib"
      memroos_load_agent_credentials || true
      break
    fi
  done
  unset _memroos_cred_lib
fi

# Resolved after credential loading, since the env file supplies the URL too.
# The loopback default is for hosts running the hooks next to a local operator;
# a profile-scoped run gets no default, so a profile without an operator URL
# records operator_unavailable instead of posting to whatever owns port 3000.
if [[ "$MEMROOS_PROFILE_SCOPED" -eq 1 ]]; then
  MEMROOS_BASE_URL="${MEMROOS_OPERATOR_URL:-${MEMROOS_APP_URL:-${MEMROOS_BASE_URL:-${MEMROOS_URL:-}}}}"
else
  MEMROOS_BASE_URL="${MEMROOS_OPERATOR_URL:-${MEMROOS_APP_URL:-${MEMROOS_BASE_URL:-${MEMROOS_URL:-http://127.0.0.1:3000}}}}"
fi

# Identity of the session this hook is running for, carried into every receipt
# so a receipt can be tied back to the agent and session that produced it.
# Additive: receipts from harnesses that pass no identity keep their old shape.
MEMROOS_HOOK_RUNTIME="${MEMROOS_HOOK_RUNTIME:-}"
MEMROOS_HOOK_SOURCE_AGENT_ID="${MEMROOS_HOOK_SOURCE_AGENT_ID:-}"
MEMROOS_HOOK_SESSION_ID="${MEMROOS_HOOK_SESSION_ID:-}"
memroos_bind_event_identity() {
  local event="$1" parsed
  parsed="$(printf '%s' "$event" | python3 -c '
import json, os, sys
try:
    record = json.loads(sys.stdin.read() or "{}")
except Exception:
    record = {}
if not isinstance(record, dict):
    record = {}
def first(keys, env):
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return os.environ.get(env, "")
print(first(["runtime", "harness"], "MEMROOS_AGENT_RUNTIME"))
print(first(["sourceAgentId", "source_agent_id", "agentId", "agent_id"], "MEMROOS_AGENT_ID"))
print(first(["sessionId", "session_id", "runId", "run_id"], "MEMROOS_SESSION_ID"))
' 2>/dev/null || true)"
  [[ -n "$parsed" ]] || return 0
  MEMROOS_HOOK_RUNTIME="$(printf '%s\n' "$parsed" | sed -n 1p)"
  MEMROOS_HOOK_SOURCE_AGENT_ID="$(printf '%s\n' "$parsed" | sed -n 2p)"
  MEMROOS_HOOK_SESSION_ID="$(printf '%s\n' "$parsed" | sed -n 3p)"
  export MEMROOS_HOOK_RUNTIME MEMROOS_HOOK_SOURCE_AGENT_ID MEMROOS_HOOK_SESSION_ID
}

# Fail open, with a named reason, when there is nowhere or nothing to post with.
# Returns 1 after writing the receipt so the caller can exit 0.
memroos_require_endpoint_and_credential() {
  local hook="$1" status="${2:-skip}"
  if [[ -z "$MEMROOS_BASE_URL" ]]; then
    memroos_record_receipt "$hook" "$status" "operator_unavailable" 0
    return 1
  fi
  if [[ "$MEMROOS_PROFILE_SCOPED" -eq 1 && -z "${MEMROOS_AGENT_API_KEY:-}" && -z "${MEMROOS_OPERATOR_API_KEY:-}" ]]; then
    memroos_record_receipt "$hook" "$status" "credential_unavailable" 0
    return 1
  fi
  return 0
}

memroos_node() {
  command -v "${MEMROOS_NODE_BIN:-node}" 2>/dev/null || true
}

# The command that parses hook payloads, as an array.
#
# python3 is tried first because it is already a hard requirement of this file
# (memroos_record_receipt is Python), while node is the dependency we are
# removing: asking every employee to install a JavaScript runtime to use
# MemroOS is a cost the hooks do not need to impose. node remains a fallback so
# a host that has not yet received the Python helper keeps capturing instead of
# going silent during a rollout.
#
# The two helpers are held to identical output by
# services/knowledge-mcp/tests/test_hook_utils_parity.py, which runs both over
# the same inputs — the redaction rules in particular must not drift, because a
# rule that silently stops matching writes credentials into a capture.
MEMROOS_HOOK_RUNNER=()
memroos_resolve_hook_runner() {
  local dir="$1" bin
  bin="$(command -v "${MEMROOS_PYTHON_BIN:-python3}" 2>/dev/null || true)"
  if [[ -n "$bin" && -f "$dir/memroos-hook-utils.py" ]]; then
    MEMROOS_HOOK_RUNNER=("$bin" "$dir/memroos-hook-utils.py")
    return 0
  fi
  bin="$(memroos_node)"
  if [[ -n "$bin" && -f "$dir/memroos-hook-utils.mjs" ]]; then
    MEMROOS_HOOK_RUNNER=("$bin" "$dir/memroos-hook-utils.mjs")
    return 0
  fi
  return 1
}

memroos_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

memroos_read_event() {
  # Harness hook payloads are bounded so a malformed stdin stream cannot turn
  # the hook into an unbounded reader.
  head -c "${MEMROOS_HOOK_MAX_INPUT_BYTES:-262144}" 2>/dev/null || true
}

memroos_record_receipt() {
  local hook="$1" status="$2" reason="$3" duration_ms="${4:-0}"
  mkdir -p "$MEMROOS_HOOK_RECEIPT_DIR" 2>/dev/null || true
  python3 - "$MEMROOS_HOOK_RECEIPT_FILE" "$hook" "$status" "$reason" "$duration_ms" \
    "$MEMROOS_HOOK_RUNTIME" "$MEMROOS_HOOK_SOURCE_AGENT_ID" "$MEMROOS_HOOK_SESSION_ID" <<'PY' 2>/dev/null || true
import json
import sys
from datetime import datetime, timezone

path, hook, status, reason, duration_ms, runtime, source_agent_id, session_id = sys.argv[1:9]
receipt = {
    "receiptType": f"{hook.replace('-', '_')}_{status}",
    "hook": hook,
    "status": status,
    "reason": reason,
    "durationMs": int(duration_ms) if duration_ms.isdigit() else 0,
    "recordedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}
if runtime:
    receipt["runtime"] = runtime
if source_agent_id:
    receipt["sourceAgentId"] = source_agent_id
if session_id:
    receipt["sessionId"] = session_id
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(receipt, separators=(",", ":")) + "\n")
PY
}

memroos_auth_headers() {
  MEMROOS_AUTH_HEADERS=(
    -H "Content-Type: application/json"
    -H "Accept: application/json"
  )
  if [[ -n "${MEMROOS_AGENT_API_KEY:-}" ]]; then
    MEMROOS_AUTH_HEADERS+=(-H "Authorization: Bearer ${MEMROOS_AGENT_API_KEY}")
  elif [[ -n "${MEMROOS_OPERATOR_API_KEY:-}" ]]; then
    MEMROOS_AUTH_HEADERS+=(-H "x-memroos-operator-key: ${MEMROOS_OPERATOR_API_KEY}")
  fi
}

memroos_epoch_ms() {
  local t
  t="$(date +%s%3N 2>/dev/null || true)"
  if [[ "$t" =~ ^[0-9]+$ ]]; then printf '%s' "$t"; else printf '%s000' "$(date +%s)"; fi
}

# POST and keep the outcome, not just the body.
#
# Sets MEMROOS_HTTP_RESPONSE, MEMROOS_HTTP_STATUS ("000" when no response
# arrived), MEMROOS_HTTP_CURL_EXIT and MEMROOS_HTTP_DURATION_MS. Returns 0 only
# for a 2xx. Callers that need to tell a timeout from a 403 from a 400 read
# these instead of inferring everything from an empty string.
memroos_post_json_status() {
  local url="$1" body="$2" max_time="$3"
  local out started ended
  memroos_auth_headers
  started="$(memroos_epoch_ms)"
  out="$(curl -sS --connect-timeout 0.75 --max-time "$max_time" \
    -w $'\n%{http_code}' \
    "${MEMROOS_AUTH_HEADERS[@]}" -X POST "$url" --data-binary "$body" 2>/dev/null)"
  MEMROOS_HTTP_CURL_EXIT=$?
  ended="$(memroos_epoch_ms)"
  MEMROOS_HTTP_DURATION_MS=$(( ended - started ))
  MEMROOS_HTTP_STATUS="${out##*$'\n'}"
  MEMROOS_HTTP_RESPONSE="${out%$'\n'*}"
  if [[ "$out" != *$'\n'* ]]; then
    MEMROOS_HTTP_RESPONSE=""
  fi
  [[ "$MEMROOS_HTTP_STATUS" =~ ^[0-9]{3}$ ]] || MEMROOS_HTTP_STATUS="000"
  [[ "$MEMROOS_HTTP_CURL_EXIT" -eq 0 && "$MEMROOS_HTTP_STATUS" == 2* ]]
}

# Name the failure class the way the report route wants a failureCode:
# lowercase, dotted, stable. Rate limit, auth, payload, runtime and transport
# used to all read "timeout or capture rejected".
memroos_http_failure_code() {
  local status="${1:-000}" curl_exit="${2:-0}"
  case "$status" in
    429) printf 'capture.rate_limited' ;;
    401|403) printf 'capture.auth_rejected' ;;
    400|413|415|422) printf 'capture.payload_rejected' ;;
    5??) printf 'capture.runtime_error' ;;
    000)
      case "$curl_exit" in
        28) printf 'capture.timeout' ;;
        *) printf 'capture.transport' ;;
      esac
      ;;
    *) printf 'capture.http_%s' "$status" ;;
  esac
}

memroos_post_json() {
  local url="$1" body="$2" max_time="$3"
  memroos_auth_headers
  curl -fsS --connect-timeout 0.75 --max-time "$max_time" \
    "${MEMROOS_AUTH_HEADERS[@]}" -X POST "$url" --data-binary "$body" 2>/dev/null
}

# Report a hook failure through the channel built to survive one.
#
# Was: post to /api/cron-health with an operator key, and `return 0` when that
# key was unset. That silently dropped the report AND returned success, so a
# failure looked identical to a delivery — which is how a Pi session recorded
# `capture_gate_failure` locally with nothing reaching MemroOS and nothing
# saying so.
#
# /api/agent-report accepts three principals (agent API key, MCP OAuth bearer,
# or an operator/admin session), so any agent, client or person who can talk to
# the instance can file. An operator key is no longer the price of being heard.
#
# When nothing can be sent, that is now written into the receipt as
# `remote_unreported` rather than swallowed. A dropped error report must leave
# a mark, or the reporting channel becomes the thing you cannot debug.
#
# The body is the fingerprint. It carries the warning, the host and the
# failure class, and nothing that changes between two occurrences of the same
# failure: the timestamp, duration and HTTP status go in `diagnostics`, which
# the route stores alongside the report but keeps out of the dedupe key. 128
# snapshot reports from one host once differed only in a `recordedAt:` line.
memroos_report_failure() {
  local warning="$1" failure_code="${2:-capture.unspecified}" http_status="${3:-}" duration_ms="${4:-}" curl_exit="${5:-}" app_error="${6:-}"
  local body response

  body="$(python3 - "$(memroos_now)" "$warning" "$(hostname 2>/dev/null || echo unknown)" \
    "$failure_code" "$http_status" "$duration_ms" "$curl_exit" "$app_error" <<'PY' 2>/dev/null || true
import json, sys
now, warning, host, failure_code, http_status, duration_ms, curl_exit, app_error = sys.argv[1:9]
diagnostics = {"hook": "capture-gate", "host": host, "recordedAt": now}
if http_status:
    diagnostics["httpStatus"] = http_status
if duration_ms.isdigit():
    diagnostics["durationMs"] = int(duration_ms)
if curl_exit.isdigit():
    diagnostics["curlExit"] = int(curl_exit)
if app_error:
    diagnostics["applicationError"] = app_error[:120]
print(json.dumps({
    "title": "Session capture gate failed",
    "body": "\n".join([warning, "", f"host: {host}", f"failure: {failure_code}"]),
    "component": "hooks",
    "severity": "medium",
    "failureCode": failure_code,
    "diagnostics": diagnostics,
}, separators=(",", ":")))
PY
)"
  [[ -n "$body" ]] || { memroos_record_receipt "capture-gate" "failure" "remote_unreported_body_build_failed" 0; return 0; }

  # No credential of any kind is still worth naming, rather than exiting quietly.
  if [[ -z "${MEMROOS_AGENT_API_KEY:-}" && -z "${MEMROOS_OPERATOR_API_KEY:-}" ]]; then
    memroos_record_receipt "capture-gate" "failure" "remote_unreported_no_credential" 0
    return 0
  fi

  response="$(memroos_post_json "${MEMROOS_BASE_URL%/}/api/agent-report" "$body" "2.0" || true)"
  if [[ -n "$response" ]]; then
    memroos_record_receipt "capture-gate" "reported" "remote_reported" 0
  else
    memroos_record_receipt "capture-gate" "failure" "remote_unreported_post_failed" 0
  fi
  return 0
}

# Retained for the NOC feed, which is a different audience from an issue report:
# cron-health answers "is this scheduled thing still running", agent-report
# answers "something went wrong, someone look". Both fire when a key allows it,
# and neither is load-bearing for the other.
memroos_post_noc_attention() {
  local warning="$1" now body
  [[ -n "${MEMROOS_OPERATOR_API_KEY:-}" ]] || return 0
  now="$(memroos_now)"
  body="$(python3 - "$now" "$warning" <<'PY' 2>/dev/null || true
import json
import sys

now, warning = sys.argv[1:]
print(json.dumps({
    "id": "observe-capture-gate",
    "name": "Session capture gate",
    "sourceFamily": "observe",
    "schedule": "on session stop",
    "expectedIntervalMinutes": 5,
    "lastRunAt": now,
    "lastFailureAt": now,
    "warning": warning[:500],
    "metadata": {"attention": "NOC", "hook": "capture-gate"},
}, separators=(",", ":")))
PY
)"
  [[ -n "$body" ]] || return 0
  curl -fsS --connect-timeout 0.25 --max-time 0.5 \
    -H "Content-Type: application/json" \
    -H "x-memroos-operator-key: ${MEMROOS_OPERATOR_API_KEY}" \
    -X POST "${MEMROOS_BASE_URL%/}/api/cron-health" \
    --data-binary "$body" >/dev/null 2>&1 || true
}
