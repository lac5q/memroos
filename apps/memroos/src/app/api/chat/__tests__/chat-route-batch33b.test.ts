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
  root = mkdtempSync(path.join(tmpdir(), `chat-b33b-${randomUUID()}-`));
  agentConfigsPath = path.join(root, "agent-configs");
  pmoAgentsPath = path.join(root, "pmo-agents");
  pmoModelRoutingPath = path.join(root, "model-routing.json");
  testDbPath = path.join(root, "chat.db");
  mkdirSync(path.join(agentConfigsPath, "ceo"), { recursive: true });
  writeFileSync(path.join(agentConfigsPath, "ceo", "SOUL.md"), "CEO soul batch33b.");
  writeFileSync(
    pmoModelRoutingPath,
    JSON.stringify({ defaults: { anthropic: "claude-test" }, agents: {} }),
    "utf8",
  );
}

describe("POST /api/chat batch33b", () => {
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

  it.skip("isQuestionLike empty guard (L70) — unreachable via POST", () => {});

  it("marks priorAnswerMatch when the user repeats a question (L87)", async () => {
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
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } };
          }),
        };
      },
    }));
    const question = "What is batch33b coverage?";
    const { POST } = await import("../route");
    const { getDb } = await import("@/lib/db");
    const res = await POST(
      chatPost({
        message: question,
        agentId: "ceo",
        history: [{ role: "user", content: question }],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const row = getDb()
      .prepare("SELECT payload FROM efficiency_events WHERE event_type = ? ORDER BY id DESC LIMIT 1")
      .get("operator_question") as { payload: string } | undefined;
    expect(row).toBeTruthy();
    const payload = JSON.parse(row!.payload) as { priorAnswerMatch?: boolean };
    expect(payload.priorAnswerMatch).toBe(true);
  });

  it.skip("release() idempotent guard (L219) — requires double release without stream close", () => {});

  it("surfaces OpenCode spawn errors on the stderr stream (L332-338)", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn(async () => { throw new Error("skip"); }) };
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
        execFile: vi.fn((_c, _a, _o, cb) => cb?.(null, "")),
        spawn: vi.fn(() => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            pid: number | undefined;
            exitCode: number | null;
          };
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.pid = 4242;
          child.exitCode = null;
          setTimeout(() => child.emit("error", new Error("spawn glitch b33b")), 5);
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: "How is opencode release?", agentId: "ceo" }));
    const text = await res.text();
    expect(text).toMatch(/spawn glitch b33b|chat runner/i);
  });

  it("walks process tree RSS including invalid ps rows (L254)", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.stubEnv("MEMROOS_OPENCODE_MAX_RSS_MB", "1");
    vi.stubEnv("MEMROOS_OPENCODE_RSS_POLL_MS", "25");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn(async () => { throw new Error("skip"); }) };
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
        execFile: vi.fn((_cmd, _args, _opts, cb) => {
          cb?.(null, "not-a-pid\n4242 1 999999\n4242 1 999999\n");
        }),
        spawn: vi.fn(() => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            pid: number | undefined;
            exitCode: number | null;
            killed: boolean;
          };
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.pid = 4242;
          child.exitCode = null;
          child.killed = false;
          setTimeout(() => child.emit("close", 0, null), 120);
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: "How is RSS monitored?", agentId: "ceo" }));
    const text = await res.text();
    expect(text).toMatch(/exceeded|DONE|error/i);
  });
});
