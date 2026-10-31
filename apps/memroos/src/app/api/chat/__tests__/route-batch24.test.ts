// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let root: string;
let agentConfigsPath: string;
let pmoAgentsPath: string;
let pmoModelRoutingPath: string;
let testDbPath: string;

const LOOPBACK = "http://localhost";

function chatPost(body: unknown): NextRequest {
  return new NextRequest(`${LOOPBACK}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAgentLayout() {
  root = mkdtempSync(path.join(tmpdir(), `chat-b24-${randomUUID()}-`));
  agentConfigsPath = path.join(root, "agent-configs");
  pmoAgentsPath = path.join(root, "pmo-agents");
  pmoModelRoutingPath = path.join(root, "model-routing.json");
  testDbPath = path.join(root, "chat.db");
  mkdirSync(path.join(agentConfigsPath, "ceo"), { recursive: true });
  writeFileSync(path.join(agentConfigsPath, "ceo", "SOUL.md"), "CEO soul batch24.");
  writeFileSync(
    pmoModelRoutingPath,
    JSON.stringify({ defaults: { anthropic: "claude-test" }, agents: {} }),
    "utf8",
  );
}

describe("POST /api/chat batch24", () => {
  beforeEach(async () => {
    await seedAgentLayout();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.doUnmock("child_process");
    vi.doUnmock("@anthropic-ai/sdk");
    vi.doUnmock("../chat-runtime");
    vi.resetModules();
  });

  it("records operator_question telemetry when memory_hits are present without a question mark", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          stream: vi.fn(async function* () {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok batch24" } };
          }),
        };
      },
    }));
    const { POST } = await import("../route");
    const { getDb } = await import("@/lib/db");
    const res2 = await POST(
      chatPost({
        message: "summarize the incident timeline",
        agentId: "ceo",
        memory_hits: ["mem-batch24"],
        history: [],
      }),
    );
    expect(res2.status).toBe(200);
    await res2.text();
    const row = getDb()
      .prepare("SELECT payload FROM efficiency_events WHERE event_type = ? ORDER BY id DESC LIMIT 1")
      .get("operator_question") as { payload: string } | undefined;
    expect(row?.payload).toBeTruthy();
    const payload = JSON.parse(row!.payload) as { priorAnswerMatch?: boolean; memoryHits?: string[] };
    expect(payload.priorAnswerMatch).toBe(false);
    expect(payload.memoryHits).toEqual(["mem-batch24"]);
  });

  it("covers OpenCode RSS guard branches and double release on close", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.stubEnv("MEMROOS_OPENCODE_MAX_RSS_MB", "1");
    vi.stubEnv("MEMROOS_OPENCODE_RSS_POLL_MS", "5");
    vi.stubEnv("MEMROOS_CHAT_TIMEOUT_MS", "5000");
    vi.stubEnv("MEMROOS_OPENCODE_KILL_GRACE_MS", "5");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn(async () => { throw new Error("skip anthropic"); }) };
      },
    }));
    vi.doMock("../chat-runtime", async () => {
      const actual = await vi.importActual<typeof import("../chat-runtime")>("../chat-runtime");
      return {
        ...actual,
        resolveChatRuntimePlan: vi.fn(async () => ({
          primary: { runner: "opencode", model: "qwen/test", source: "env", detail: "opencode" },
          candidates: [{ runner: "opencode", model: "qwen/test", source: "env", detail: "opencode" }],
        })),
        chatRuntimeStatus: vi.fn(() => ({ status: "ready", detail: "ready" })),
      };
    });
    vi.doMock("child_process", async () => {
      const { EventEmitter } = await import("events");
      return {
        execFile: vi.fn(
          (_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, stdout: string) => void) => {
            cb?.(null, "99999 1 4096000\n0 1 1024\ninvalid not-a-number\n");
          },
        ),
        spawn: vi.fn(() => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            pid: number | undefined;
            exitCode: number | null;
          };
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.pid = 99999;
          child.exitCode = null;
          setTimeout(() => child.emit("close", null, "SIGTERM"), 30);
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: "What changed?", agentId: "ceo" }));
    const text = await res.text();
    expect(text).toMatch(/exceeded.*RSS/i);
  });

  it("ignores chat timeout kill when OpenCode child has no pid", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.stubEnv("MEMROOS_CHAT_TIMEOUT_MS", "1");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn(async () => { throw new Error("skip anthropic"); }) };
      },
    }));
    vi.doMock("../chat-runtime", async () => {
      const actual = await vi.importActual<typeof import("../chat-runtime")>("../chat-runtime");
      return {
        ...actual,
        resolveChatRuntimePlan: vi.fn(async () => ({
          primary: { runner: "opencode", model: "qwen/test", source: "env", detail: "opencode" },
          candidates: [{ runner: "opencode", model: "qwen/test", source: "env", detail: "opencode" }],
        })),
        chatRuntimeStatus: vi.fn(() => ({ status: "ready", detail: "ready" })),
      };
    });
    vi.doMock("child_process", async () => {
      const { EventEmitter } = await import("events");
      return {
        execFile: vi.fn((_cmd, _args, _opts, cb) => cb?.(null, "")),
        spawn: vi.fn(() => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            pid: number | undefined;
            exitCode: number | null;
          };
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.pid = undefined;
          child.exitCode = null;
          setTimeout(() => child.emit("close", 1, null), 20);
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: "ping batch24", agentId: "ceo" }));
    expect(res.status).toBe(200);
    await res.text();
  });
});
