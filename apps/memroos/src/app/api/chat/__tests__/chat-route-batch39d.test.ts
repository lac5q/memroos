// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const LOOPBACK = "http://localhost";

let root: string;
let agentConfigsPath: string;
let pmoAgentsPath: string;
let pmoModelRoutingPath: string;
let testDbPath: string;

function chatPost(body: unknown): NextRequest {
  return new NextRequest(`${LOOPBACK}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAgentLayout() {
  root = mkdtempSync(path.join(tmpdir(), `chat-b39d-${randomUUID()}-`));
  agentConfigsPath = path.join(root, "agent-configs");
  pmoAgentsPath = path.join(root, "pmo-agents");
  pmoModelRoutingPath = path.join(root, "model-routing.json");
  testDbPath = path.join(root, "chat.db");
  mkdirSync(path.join(agentConfigsPath, "ceo"), { recursive: true });
  writeFileSync(path.join(agentConfigsPath, "ceo", "SOUL.md"), "CEO soul batch39d.");
  writeFileSync(
    pmoModelRoutingPath,
    JSON.stringify({ defaults: { anthropic: "claude-test" }, agents: {} }),
    "utf8",
  );
}

describe("POST /api/chat batch39d", () => {
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

  it.skip("isQuestionLike empty guard (70) — POST rejects empty trim before telemetry", () => {});

  it.skip("priorUserQuestionMatch empty normalized (87) — POST requires non-empty trim", () => {});

  it("records operator_question telemetry for memoryHits without a question mark (101)", async () => {
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
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "batch39d-ok" } };
          }),
        };
      },
    }));
    const { POST } = await import("../route");
    const { getDb } = await import("@/lib/db");
    const marker = `memory-hit-b39d-${randomUUID().slice(0, 6)}`;
    const res = await POST(
      chatPost({
        message: `Proceed with ${marker}`,
        agentId: "ceo",
        memoryHits: [`hit-${marker}`],
      }),
    );
    expect(res.status).toBe(200);
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM efficiency_events WHERE event_type = ?")
      .get("operator_question") as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });

  it.skip("release() idempotent guard (219) — error+close handlers enqueue twice and close controller early", () => {});

  it("surfaces opencode spawn failure without anthropic stream", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          stream: vi.fn(async () => {
            throw new Error("skip anthropic");
          }),
        };
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
        execFile: vi.fn(),
        spawn: vi.fn(() => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            pid: number;
            exitCode: number | null;
          };
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.pid = 5100;
          child.exitCode = null;
          queueMicrotask(() => {
            child.emit("error", new Error("opencode spawn failed batch39d"));
          });
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: `What is batch39d opencode ${randomUUID().slice(0, 4)}?`, agentId: "ceo" }));
    const body = await res.text();
    expect(body).toMatch(/error|opencode|local/i);
  });
});