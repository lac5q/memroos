"""MemRoOS Hermes memory provider — dual-mode (opt-in observe).

Built-in Hermes MEMORY.md / USER.md remain always-on and are NEVER rewritten
by this plugin. When activated via ``memory.provider: memroos``, MemRoOS
mirrors built-in memory writes to POST /api/native-memory/ingest in
``observe`` mode (fail-open: ingest errors never block Hermes).

Modes (``$HERMES_HOME/memroos-memory.json``):
  observe   — default when provider is on; mirror only (safe for local testing)
  governed  — reserved / deferred; still does not rewrite MEMORY.md in v1

Profile safety: one Hermes process may serve several profiles. Every call
resolves the Hermes home it is handed (``initialize(hermes_home=...)``) or the
profile-scoped ``hermes_constants.get_hermes_home()``; config, receipts and
counters are keyed by that home, and credentials are read through
``agent.secret_scope.get_secret`` so a profile never sees a sibling's key.

Disable entirely with ``hermes memory off`` or unset ``memory.provider``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from agent.memory_provider import MemoryProvider

try:  # Hermes >= 0.21: profile-scoped credential reads.
    from agent.secret_scope import get_secret as _hermes_get_secret
except ImportError:  # pragma: no cover - older Hermes / standalone tests
    _hermes_get_secret = None

try:  # Hermes home honouring the context-local profile override.
    from hermes_constants import get_hermes_home as _hermes_get_home
    from hermes_constants import get_hermes_home_override as _hermes_get_home_override
    from hermes_constants import hermes_home_key as _hermes_home_key
except ImportError:  # pragma: no cover - older Hermes / standalone tests
    _hermes_get_home = None
    _hermes_get_home_override = None
    _hermes_home_key = None

logger = logging.getLogger(__name__)

_DEFAULT_MODE = "observe"
_ALLOWED_MODES = frozenset({"observe", "governed"})
_CONFIG_NAME = "memroos-memory.json"
_RECEIPTS_DIR = "memroos-memory"
_TIMEOUT_S = 5.0
_API_KEY_ENV_VARS = ("MEMROOS_AGENT_API_KEY", "MEMROOS_OPERATOR_API_KEY")
# Host-wide hook settings that must never leak into a profile's hook child.
_HOOK_HOST_ENV_VARS = (
    "MEMROOS_OPERATOR_URL",
    "MEMROOS_APP_URL",
    "MEMROOS_BASE_URL",
    "MEMROOS_URL",
    "MEMROOS_HOOK_RECEIPT_FILE",
)
_PLUGIN_HOOKS_DIR = Path(__file__).resolve().parent / "hooks"
_TRUTHY = frozenset({"1", "true", "yes"})
_SUMMARY_EXCERPT_CHARS = 500
_SUMMARY_MESSAGE_CHARS = 1500
_SUMMARY_MESSAGE_LIMIT = 12
_METADATA_KEYS = ("session_id", "task_id", "tool_call_id", "old_text", "source", "platform")

# Same rules, same order, as scripts/hooks/memroos-hook-utils.py::redact_secret_text.
_REDACTIONS: Tuple[Tuple["re.Pattern[str]", str], ...] = (
    (
        re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----", re.IGNORECASE),
        "[REDACTED_PRIVATE_KEY]",
    ),
    (re.compile(r"(\bBearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE), r"\1[REDACTED]"),
    (
        re.compile(
            r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_-]{16,}"
            r"|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{12,})\b"
        ),
        "[REDACTED_TOKEN]",
    ),
    (
        re.compile(
            r"(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)"
            r"\s*[:=]\s*[\"']?)[^\s,\"'}]+",
            re.IGNORECASE,
        ),
        r"\1[REDACTED]",
    ),
)

_PENDING_BRIEFS: Dict[Tuple[str, str], str] = {}
"""Session-start briefs awaiting their first ``prefetch``, keyed (home key, session id).

Process-level because Hermes may hand the ``on_session_start`` hook and ``prefetch`` to
different provider instances (general plugin manager vs. the agent's MemoryManager)."""


def _hermes_home(kwargs_home: Optional[str] = None) -> Path:
    """Resolve the Hermes home for THIS call: explicit > profile override > env > default."""
    if kwargs_home:
        return Path(kwargs_home)
    if _hermes_get_home is not None:
        try:
            return Path(_hermes_get_home())
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("memroos: get_hermes_home failed, falling back to env: %s", exc)
    env = os.environ.get("HERMES_HOME", "").strip()
    if env:
        return Path(env)
    return Path.home() / ".hermes"


def _home_key(home: Path) -> str:
    """Stable per-profile registry key (Hermes' own when available)."""
    if _hermes_home_key is not None:
        try:
            return _hermes_home_key(home)
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("memroos: hermes_home_key failed, resolving locally: %s", exc)
    try:
        return str(home.resolve(strict=False))
    except Exception:  # pragma: no cover - defensive
        return str(home)


def _profile_home_override() -> Optional[str]:
    """The context-local profile home Hermes bound for this call, if any."""
    if _hermes_get_home_override is None:
        return None
    try:
        return _hermes_get_home_override() or None
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("memroos: get_hermes_home_override failed: %s", exc)
        return None


def _scoped_secret(name: str) -> str:
    """One credential through Hermes' profile scope (env only without ``secret_scope``)."""
    if _hermes_get_secret is not None:
        value = _hermes_get_secret(name, "")
    else:
        value = os.environ.get(name, "")
    return (value or "").strip()


def resolve_api_key() -> str:
    """Profile-scoped MemRoOS credential.

    Reads through ``agent.secret_scope.get_secret`` when Hermes provides it, so a
    multiplexed gateway never hands one profile another profile's key.
    ``UnscopedSecretError`` is deliberately NOT swallowed: it marks a caller that
    forgot to bind the profile scope, and reading ``os.environ`` there would leak.
    The environment fallback only applies to Hermes builds without ``secret_scope``.
    """
    for name in _API_KEY_ENV_VARS:
        value = _scoped_secret(name)
        if value:
            return value
    return ""


def redact_secret_text(value: Any) -> str:
    """Strip credentials from transcript text before it leaves the process."""
    text = "" if value is None else str(value)
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def _dry_run(config: Dict[str, Any]) -> bool:
    if config.get("dry_run") is True:
        return True
    return os.environ.get("MEMROOS_HERMES_DRY_RUN", "").strip().lower() in _TRUTHY


def load_memroos_config(hermes_home: Path) -> Dict[str, Any]:
    path = hermes_home / _CONFIG_NAME
    # Same scope rules as the API key: the profile's .env overlay wins, and under
    # a multiplexed gateway a miss stays a miss rather than another profile's URL.
    env_url = _scoped_secret("MEMROOS_OPERATOR_URL") or _scoped_secret("MEMROOS_APP_URL")
    if not path.is_file():
        return {
            "mode": _DEFAULT_MODE,
            "operator_url": env_url.strip().rstrip("/"),
            "rewrite_local": False,
            "dry_run": False,
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"mode": _DEFAULT_MODE, "operator_url": "", "rewrite_local": False, "dry_run": False}
        mode = str(data.get("mode") or _DEFAULT_MODE).strip().lower()
        if mode not in _ALLOWED_MODES:
            mode = _DEFAULT_MODE
        url = str(data.get("operator_url") or env_url).strip().rstrip("/")
        # Hard rule: never rewrite local MEMORY.md in v1.
        return {
            "mode": mode,
            "operator_url": url,
            "rewrite_local": False,
            "dry_run": data.get("dry_run") is True,
            "agent_id": str(data.get("agent_id") or "hermes"),
            "user_id": str(data.get("user_id") or os.environ.get("USER") or "local"),
        }
    except Exception as exc:
        logger.warning("memroos: failed to read %s: %s", path, exc)
        return {"mode": _DEFAULT_MODE, "operator_url": "", "rewrite_local": False, "dry_run": False}


def write_memroos_config(hermes_home: Path, values: Dict[str, Any]) -> Path:
    """Persist ``memroos-memory.json`` for one home; ``rewrite_local`` is always false."""
    hermes_home.mkdir(parents=True, exist_ok=True)
    path = hermes_home / _CONFIG_NAME
    existing = load_memroos_config(hermes_home)
    mode = str(values.get("mode") or existing.get("mode") or _DEFAULT_MODE).lower()
    if mode not in _ALLOWED_MODES:
        mode = _DEFAULT_MODE
    payload = {
        "mode": mode,
        "operator_url": str(
            values.get("operator_url") or existing.get("operator_url") or ""
        ).strip().rstrip("/"),
        "rewrite_local": False,
        "dry_run": values.get("dry_run") is True or (values.get("dry_run") is None and existing.get("dry_run") is True),
        "agent_id": str(values.get("agent_id") or existing.get("agent_id") or "hermes"),
        "user_id": str(values.get("user_id") or existing.get("user_id") or os.environ.get("USER") or "local"),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def append_local_receipt(hermes_home: Path, receipt: Dict[str, Any]) -> Path:
    """Persist an observe receipt under the given Hermes home (never touches MEMORY.md)."""
    out_dir = hermes_home / _RECEIPTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "observe-receipts.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(receipt, ensure_ascii=False) + "\n")
    return path


def post_native_memory_ingest(
    *,
    operator_url: str,
    api_key: str,
    body: Dict[str, Any],
    timeout_s: float = _TIMEOUT_S,
) -> Dict[str, Any]:
    """POST to MemRoOS native-memory ingest. Raises on HTTP/network errors."""
    url = f"{operator_url.rstrip('/')}/api/native-memory/ingest"
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _message_text(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("type") in {None, "text"}
        ]
        return "\n".join(p for p in parts if p)
    return ""


def summarize_messages(messages: Any) -> Dict[str, Any]:
    """Bounded, secret-free view of a Hermes transcript for the capture gate."""
    items = [m for m in (messages or []) if isinstance(m, dict)] if isinstance(messages, list) else []
    last_user = ""
    last_assistant = ""
    for message in reversed(items):
        role = str(message.get("role") or "")
        text = redact_secret_text(_message_text(message)).strip()
        if not text:
            continue
        if role == "user" and not last_user:
            last_user = text[:_SUMMARY_EXCERPT_CHARS]
        elif role == "assistant" and not last_assistant:
            last_assistant = text[:_SUMMARY_EXCERPT_CHARS]
        if last_user and last_assistant:
            break
    summary = " | ".join(
        part for part in (f"user: {last_user}" if last_user else "", f"assistant: {last_assistant}" if last_assistant else "")
        if part
    )
    bounded: List[Dict[str, str]] = []
    for message in items[-_SUMMARY_MESSAGE_LIMIT:]:
        text = redact_secret_text(_message_text(message))
        if not text:
            continue
        bounded.append({"role": str(message.get("role") or ""), "content": text[:_SUMMARY_MESSAGE_CHARS]})
    return {
        "message_count": len(items),
        "summary": summary,
        "last_user_excerpt": last_user,
        "last_assistant_excerpt": last_assistant,
        "messages": bounded,
    }


def _provenance(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep only known provenance keys; never echo content or credentials."""
    if not isinstance(metadata, dict):
        return {}
    out: Dict[str, Any] = {}
    for key in _METADATA_KEYS:
        if key not in metadata:
            continue
        value = metadata[key]
        if key == "old_text":
            out["old_text_chars"] = len(value) if isinstance(value, str) else None
        elif isinstance(value, (str, int, float, bool)) or value is None:
            out[key] = value
    return out


class _ProfileState:
    """Per-Hermes-home state; one process may serve several profiles.

    ``session_id`` / ``agent_context`` are only the LAST session bound to this home — the
    fallback for callbacks Hermes hands over without a session id (``on_session_end``,
    ``on_pre_compress``). Anything carrying one resolves through ``_SessionState``."""

    __slots__ = ("home", "config", "session_id", "agent_context", "last_ingest_ok", "last_error", "mirror_count")

    def __init__(self, home: Path) -> None:
        self.home = home
        self.config: Dict[str, Any] = load_memroos_config(home)
        self.session_id = ""
        self.agent_context = "primary"
        self.last_ingest_ok: Optional[bool] = None
        self.last_error: Optional[str] = None
        self.mirror_count = 0


class _SessionState:
    """Per-session binding: the home a session was initialized for and its agent context."""

    __slots__ = ("session_id", "home", "agent_context")

    def __init__(self, session_id: str, home: Path, agent_context: str) -> None:
        self.session_id = session_id
        self.home = home
        self.agent_context = agent_context


class MemroosMemoryProvider(MemoryProvider):
    """Additive MemRoOS memory provider — observe-mode mirror."""

    def __init__(self) -> None:
        self._profiles: Dict[str, _ProfileState] = {}
        self._sessions: Dict[str, _SessionState] = {}

    # ----- profile-keyed state -----

    def _state(self, hermes_home: Optional[str] = None, *, session_id: str = "") -> _ProfileState:
        """Home for THIS call: explicit > context-local profile override > the home the
        session was initialized for > ambient (env / default)."""
        home: Optional[Path] = Path(hermes_home) if hermes_home else None
        if home is None and session_id and not _profile_home_override():
            session = self._sessions.get(session_id)
            if session is not None:
                home = session.home
        if home is None:
            home = _hermes_home(None)
        key = _home_key(home)
        state = self._profiles.get(key)
        if state is None:
            state = _ProfileState(home)
            self._profiles[key] = state
        return state

    def _bind_session(self, state: _ProfileState, session_id: str, agent_context: Optional[str] = None) -> _SessionState:
        session = self._sessions.get(session_id)
        context = agent_context or (session.agent_context if session is not None else "primary")
        session = _SessionState(session_id, state.home, context)
        self._sessions[session_id] = session
        state.session_id = session_id
        state.agent_context = context
        return session

    def _session_for(self, state: _ProfileState, session_id: str) -> Tuple[str, str]:
        """(session id, agent context) for a callback: the named session, else the home's last."""
        if session_id:
            session = self._sessions.get(session_id)
            if session is not None:
                return session.session_id, session.agent_context
            return session_id, "primary"
        return state.session_id, state.agent_context

    @property
    def name(self) -> str:
        return "memroos"

    def is_available(self) -> bool:
        """No network — the provider lists as available so setup/dry-run can proceed;
        ``initialize`` logs when neither URL nor key nor dry-run is configured."""
        return True

    def unavailable_reason(self) -> str:
        return ""

    def initialize(self, session_id: str, **kwargs) -> None:
        state = self._state(kwargs.get("hermes_home"))
        state.config = load_memroos_config(state.home)
        self._bind_session(state, session_id, str(kwargs.get("agent_context") or "primary"))
        logger.info(
            "memroos memory provider initialized mode=%s rewrite_local=%s url=%s home=%s",
            state.config.get("mode"),
            state.config.get("rewrite_local"),
            bool(state.config.get("operator_url")),
            state.home,
        )

    # ----- setup -----

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "api_key",
                "description": "MemRoOS agent or operator API key",
                "secret": True,
                "required": False,
                "env_var": "MEMROOS_AGENT_API_KEY",
            },
            {
                "key": "operator_url",
                "description": "MemRoOS operator base URL (e.g. http://127.0.0.1:3000)",
                "default": "http://127.0.0.1:3000",
            },
            {
                "key": "mode",
                "description": "observe = mirror only (recommended); governed = reserved",
                "default": "observe",
                "choices": ["observe", "governed"],
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        home = Path(hermes_home)
        write_memroos_config(home, values)
        self._profiles.pop(_home_key(home), None)

    def post_setup(self, hermes_home: str, config: dict) -> None:
        """``hermes memory setup`` flow: prompt through Hermes' own helpers, persist
        ``memroos-memory.json`` for THIS home, store the key via Hermes' ``.env`` writer,
        and activate the provider. No parallel top-level command."""
        from hermes_cli.config import save_config
        from hermes_cli.memory_setup import _prompt, _write_env_vars

        home = Path(hermes_home)
        existing = load_memroos_config(home)
        print("\n  Configuring memroos (observe mode; built-in MEMORY.md stays primary):\n")
        operator_url = _prompt(
            "MemRoOS operator base URL", default=existing.get("operator_url") or "http://127.0.0.1:3000"
        )
        mode = _prompt("Mode (observe|governed)", default=existing.get("mode") or _DEFAULT_MODE).lower()
        current_key = resolve_api_key()
        masked = f"...{current_key[-4:]}" if len(current_key) > 4 else ("set" if current_key else "")
        key_label = (
            f"MemRoOS agent API key (current: {masked}, blank to keep)" if current_key else "MemRoOS agent API key"
        )
        api_key = _prompt(key_label, secret=True)
        write_memroos_config(home, {"operator_url": operator_url, "mode": mode})
        if api_key:
            _write_env_vars({"MEMROOS_AGENT_API_KEY": api_key}, hermes_home=hermes_home)
        memory = config["memory"] = config["memory"] if isinstance(config.get("memory"), dict) else {}
        memory["provider"] = self.name
        save_config(config)
        self._profiles.pop(_home_key(home), None)
        print(
            "\n  Memory provider: memroos\n"
            f"  Config: {home / _CONFIG_NAME}\n"
            f"  Receipts: {home / _RECEIPTS_DIR / 'observe-receipts.jsonl'}\n"
            "  Activation saved to config.yaml"
            + ("\n  API key saved to .env" if api_key else "")
            + "\n\n  Start a new session to activate. `hermes memory off` returns to built-in only.\n"
        )

    # ----- prompt / tools -----

    def system_prompt_block(self) -> str:
        mode = self._state().config.get("mode", _DEFAULT_MODE)
        return (
            "MemRoOS memory provider is active in "
            f"**{mode}** mode. Built-in MEMORY.md remains the local source of truth. "
            "MemRoOS receives mirrored copies for governance testing; it does not "
            "replace Hermes memory. Prefer skills for procedural lessons."
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Deliver the session-start memory brief on the first turn of the session.

        ``on_session_start`` hook results are discarded by Hermes; ``prefetch`` is the
        sanctioned injection path, so the brief produced there is handed over here once.
        """
        state = self._state(session_id=session_id)
        sid = session_id or state.session_id
        return _PENDING_BRIEFS.pop((_home_key(state.home), sid), "") if sid else ""

    def on_session_switch(
        self, new_session_id: str, *, parent_session_id: str = "", reset: bool = False, **kwargs: Any
    ) -> None:
        """Hermes rotated ``session_id`` without teardown (/new, /resume, compression): rebind
        so later receipts and hook payloads name the live session."""
        state = self._state()
        previous = state.session_id
        self._bind_session(state, new_session_id, state.agent_context)
        if reset and previous:
            _PENDING_BRIEFS.pop((_home_key(state.home), previous), None)

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "memroos_memory_status",
                "description": (
                    "Show MemRoOS Hermes dual-mode memory status (mode, mirror count, "
                    "last ingest result). Does not change MEMORY.md."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            }
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if tool_name != "memroos_memory_status":
            return json.dumps({"error": f"unknown tool {tool_name}"})
        state = self._state()
        return json.dumps(
            {
                "provider": "memroos",
                "mode": state.config.get("mode"),
                "rewrite_local": False,
                "operator_url_configured": bool(state.config.get("operator_url")),
                "hermes_home": str(state.home),
                "mirror_count": state.mirror_count,
                "last_ingest_ok": state.last_ingest_ok,
                "last_error": state.last_error,
                "builtin_memory": "always_on",
            }
        )

    # ----- memory mirror -----

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror built-in writes. Never rewrite MEMORY.md. Fail-open."""
        provenance = _provenance(metadata)
        write_session = str(provenance.get("session_id") or "")
        state = self._state(session_id=write_session)
        session_id, agent_context = self._session_for(state, write_session)
        if agent_context not in {"primary", ""}:
            return
        if action not in {"add", "replace"}:
            # removals: record receipt only; MemRoOS tombstone is separate path
            self._record(
                state,
                action=action,
                target=target,
                content=content,
                ingest=None,
                error="skipped_non_add",
                provenance=provenance,
                session_id=session_id,
            )
            return

        mode = state.config.get("mode", _DEFAULT_MODE)
        if mode not in _ALLOWED_MODES:
            mode = _DEFAULT_MODE

        # Hard guarantee: never rewrite local files in v1 (even if config lies).
        if state.config.get("rewrite_local") is True:
            logger.warning("memroos: rewrite_local ignored — v1 forbids rewriting MEMORY.md")

        api_key = resolve_api_key()
        operator_url = str(state.config.get("operator_url") or "").strip()
        dry_run = _dry_run(state.config)

        body = {
            "source": "hermes",
            "agentId": str(state.config.get("agent_id") or "hermes"),
            "userId": str(state.config.get("user_id") or "local"),
            "content": content,
            "memoryPath": f"MEMORY.md#{target}",
        }

        ingest_result: Optional[Dict[str, Any]] = None
        error: Optional[str] = None

        if operator_url and api_key and not dry_run:
            try:
                ingest_result = post_native_memory_ingest(
                    operator_url=operator_url,
                    api_key=api_key,
                    body=body,
                )
                state.last_ingest_ok = True
                state.last_error = None
            except Exception as exc:
                # Fail-open: Hermes built-in write already succeeded.
                error = str(exc)
                state.last_ingest_ok = False
                state.last_error = error
                logger.warning("memroos observe ingest failed (Hermes memory unchanged): %s", exc)
        else:
            error = "dry_run_or_missing_credentials"
            state.last_ingest_ok = None
            state.last_error = error

        state.mirror_count += 1
        self._record(
            state,
            action=action,
            target=target,
            content=content,
            ingest=ingest_result,
            error=error,
            mode=mode,
            provenance=provenance,
            session_id=session_id,
        )

    # ----- lifecycle -----

    @staticmethod
    def _hook_env(state: _ProfileState) -> Dict[str, str]:
        """Subprocess environment carrying THIS profile's endpoint and credentials only.

        Inherited ``MEMROOS_*_API_KEY`` values, host-wide operator URLs and the
        receipt-file override are dropped first so a profile without a key or URL
        never posts with a sibling's or the process-global one, and never writes
        its receipts into another profile's ledger. ``MEMROOS_CREDENTIAL_SCOPE``
        tells the hooks the credential decision is already made: they must not
        fall back to the host's on-disk keys or the loopback operator default."""
        dropped = set(_API_KEY_ENV_VARS) | set(_HOOK_HOST_ENV_VARS)
        env = {k: v for k, v in os.environ.items() if k not in dropped}
        env["HERMES_HOME"] = str(state.home)
        operator_url = str(state.config.get("operator_url") or "").strip()
        if operator_url:
            env["MEMROOS_OPERATOR_URL"] = operator_url
        for name in _API_KEY_ENV_VARS:
            value = _scoped_secret(name)
            if value:
                env[name] = value
        profile_dir = state.home / _RECEIPTS_DIR
        env["MEMROOS_CREDENTIAL_SCOPE"] = "hermes-profile"
        env["MEMROOS_BUG_REPORT_DIR"] = str(profile_dir / "bug-reports")
        env["MEMROOS_HOOK_RECEIPT_DIR"] = str(profile_dir / "hook-receipts")
        env["MEMROOS_HOOK_RECEIPT_FILE"] = str(profile_dir / "hook-receipts" / "session-hooks.jsonl")
        return env

    @staticmethod
    def _hook_search_roots() -> List[Path]:
        """Hook directories in lookup order: explicit root, central installer, plugin-local.

        The plugin-local copy is what makes a URL/catalog-installed plugin work on a
        host that never ran the MemRoOS installer; fleet hosts keep ``~/.memroos/hooks``
        first so a centrally managed hook set still wins there."""
        roots: List[Path] = []
        explicit = os.environ.get("MEMROOS_HOOK_ROOT", "").strip()
        if explicit:
            roots.append(Path(explicit) / "hooks")
        roots.append(Path.home() / ".memroos" / "hooks")
        roots.append(_PLUGIN_HOOKS_DIR)
        return roots

    @classmethod
    def _resolve_hook_script(cls, hook_name: str) -> Optional[Path]:
        for root in cls._hook_search_roots():
            script = root / hook_name
            if script.is_file():
                return script
        return None

    def _run_lifecycle_hook(
        self,
        hook_name: str,
        payload: Optional[Dict[str, Any]] = None,
        timeout_s: float = 5.0,
        *,
        state: Optional[_ProfileState] = None,
        session_id: str = "",
    ) -> str:
        """Run the shared fail-open hook and return only its injection text."""
        state = state or self._state()
        script = self._resolve_hook_script(hook_name)
        if script is None:
            # No hook anywhere (not even the plugin-local copy): Hermes must
            # continue with its native lifecycle in that state.
            return ""
        body = {
            "sourceAgentId": str(state.config.get("agent_id") or "hermes"),
            "runtime": "hermes",
            "sessionId": session_id or state.session_id,
            "hermesHome": str(state.home),
            **(payload or {}),
        }
        try:
            completed = subprocess.run(
                ["/bin/bash", str(script)],
                input=json.dumps(body),
                text=True,
                capture_output=True,
                timeout=timeout_s,
                check=False,
                env=self._hook_env(state),
            )
            if completed.returncode != 0:
                logger.warning("memroos lifecycle hook %s returned %s (fail-open)", hook_name, completed.returncode)
                return ""
            return completed.stdout.strip() if hook_name.endswith("brief.sh") else ""
        except subprocess.TimeoutExpired:
            logger.warning("memroos lifecycle hook %s timed out (fail-open)", hook_name)
            return ""
        except Exception as exc:
            logger.warning("memroos lifecycle hook %s failed (fail-open): %s", hook_name, exc)
            return ""

    def on_session_start(self, session_id: str = "", model: str = "", platform: str = "", **kwargs: Any) -> None:
        """General Hermes ``on_session_start`` hook (registered in ``register``).

        Runs the bounded memory brief and parks the text for the first ``prefetch``.
        Empty output is a miss; nothing here can block the session.
        """
        state = self._state(session_id=session_id)
        if session_id:
            self._bind_session(state, session_id)
        sid = session_id or state.session_id
        payload = {"sessionId": sid, "model": model, "platform": platform, **kwargs}
        brief = self._run_lifecycle_hook(
            "memroos-memory-brief.sh", payload, timeout_s=2.0, state=state, session_id=sid
        )
        if brief and sid:
            _PENDING_BRIEFS[(_home_key(state.home), sid)] = brief

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Hermes session boundary: run the fail-open capture gate over a bounded summary."""
        state = self._state()
        payload = {"phase": "stop", **summarize_messages(messages)}
        self._run_lifecycle_hook("memroos-capture-gate.sh", payload, timeout_s=5.0, state=state)
        if state.session_id:
            _PENDING_BRIEFS.pop((_home_key(state.home), state.session_id), None)
            self._sessions.pop(state.session_id, None)

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """Hermes pre-compression: capture the about-to-be-compressed span; never blocks compaction.
        Returns "" — MemRoOS does not feed the summary prompt."""
        state = self._state()
        payload = {"phase": "pre_compress", **summarize_messages(messages)}
        self._run_lifecycle_hook("memroos-capture-gate.sh", payload, timeout_s=5.0, state=state)
        return ""

    def _record(
        self,
        state: _ProfileState,
        *,
        action: str,
        target: str,
        content: str,
        ingest: Optional[Dict[str, Any]],
        error: Optional[str],
        mode: Optional[str] = None,
        provenance: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ) -> None:
        receipt = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "session_id": state.session_id if session_id is None else session_id,
            "hermes_home": str(state.home),
            "mode": mode or state.config.get("mode"),
            "action": action,
            "target": target,
            "content_chars": len(content or ""),
            "content_preview": (content or "")[:120],
            "runtime": "hermes",
            "sourceAgentId": str(state.config.get("agent_id") or "hermes"),
            "sessionId": state.session_id if session_id is None else session_id,
            # True only when the HTTP sink call returned 2xx. The sink is
            # non-destructive and may still decline to store (policy, budget),
            # so this is not a durable-storage claim; ingestId is the server's
            # handle for tracing what happened to the call.
            "http_ok": ingest is not None and error is None,
            "ingestId": (ingest or {}).get("ingestId"),
            "budget_status": (ingest or {}).get("budgetStatus"),
            "alerts": (ingest or {}).get("alerts"),
            "error": error,
            "rewrite_local": False,
        }
        if provenance:
            receipt["metadata"] = provenance
        try:
            append_local_receipt(state.home, receipt)
        except Exception as exc:
            logger.debug("memroos: receipt write failed: %s", exc)


def register(ctx) -> None:
    """Hermes plugin entry — register the provider and its session-start hook."""
    provider = MemroosMemoryProvider()
    ctx.register_memory_provider(provider)
    register_hook: Optional[Callable[..., Any]] = getattr(ctx, "register_hook", None)
    if callable(register_hook):
        register_hook("on_session_start", provider.on_session_start)
