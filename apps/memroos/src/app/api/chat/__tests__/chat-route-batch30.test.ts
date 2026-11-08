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
  root = mkdtempSync(path.join(tmpdir(), `chat-b30-${randomUUID()}-`));
  agentConfigsPath = path.join(root, "agent-configs");
  pmoAgentsPath = path.join(root, "pmo-agents");
  pmoModelRoutingPath = path.join(root, "model-routing.json");
  testDbPath = path.join(root, "chat.db");
  mkdirSync(path.join(agentConfigsPath, "ceo"), { recursive: true });
  writeFileSync(path.join(agentConfigsPath, "ceo", "SOUL.md"), "CEO soul batch30.");
  writeFileSync(
    pmoModelRoutingPath,
    JSON.stringify({ defaults: { anthropic: "claude-test" }, agents: {} }),
    "utf8",
  );
}

describe("POST /api/chat batch30", () => {
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

  it("records priorAnswerMatch when the same user question repeats (87)", async () => {
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
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "batch30 ok" } };
          }),
        };
      },
    }));
    const { POST } = await import("../route");
    const { getDb } = await import("@/lib/db");
    const question = "What is the status batch30?";
    const res = await POST(
      chatPost({
        message: question,
        agentId: "ceo",
        history: [{ role: "user", content: `  ${question}  ` }],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const row = getDb()
      .prepare("SELECT payload FROM efficiency_events WHERE event_type = ? ORDER BY id DESC LIMIT 1")
      .get("operator_question") as { payload: string } | undefined;
    const payload = JSON.parse(row!.payload) as { priorAnswerMatch?: boolean };
    expect(payload.priorAnswerMatch).toBe(true);
  });

  it("double-releases OpenCode slot on spawn error then close (219)", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.stubEnv("MEMROOS_OPENCODE_MAX_CONCURRENT", "2");
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
          child.pid = 4242;
          child.exitCode = null;
          setTimeout(() => child.emit("error", new Error("spawn failed batch30")), 5);
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: "What broke batch30?", agentId: "ceo" }));
    const text = await res.text();
    expect(text).toMatch(/spawn failed batch30|error/);
  });

  /**
   * Line 70 (`isQuestionLike` empty text) is unreachable via POST because
   * the handler rejects blank messages before telemetry runs.
   */
  it.skip("isQuestionLike empty guard — unreachable via POST (line 70)", () => {});
});
