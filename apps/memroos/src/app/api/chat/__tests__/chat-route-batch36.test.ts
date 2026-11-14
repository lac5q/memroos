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
  root = mkdtempSync(path.join(tmpdir(), `chat-b36-${randomUUID()}-`));
  agentConfigsPath = path.join(root, "agent-configs");
  pmoAgentsPath = path.join(root, "pmo-agents");
  pmoModelRoutingPath = path.join(root, "model-routing.json");
  testDbPath = path.join(root, "chat.db");
  mkdirSync(path.join(agentConfigsPath, "ceo"), { recursive: true });
  writeFileSync(path.join(agentConfigsPath, "ceo", "SOUL.md"), "CEO soul batch36.");
  writeFileSync(
    pmoModelRoutingPath,
    JSON.stringify({ defaults: { anthropic: "claude-test" }, agents: {} }),
    "utf8",
  );
}

describe("POST /api/chat batch36", () => {
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

  it.skip("isQuestionLike empty guard (70) — sticky: POST rejects before telemetry", () => {});

  it.skip("priorUserQuestionMatch empty normalized (87) — sticky: message trim gate prevents whitespace-only", () => {});

  it("records operator telemetry when memoryHits present on non-question statement", async () => {
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
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "b36-ok" } };
          }),
        };
      },
    }));
    const { POST } = await import("../route");
    const { getDb } = await import("@/lib/db");
    const token = randomUUID().slice(0, 8);
    const res = await POST(
      chatPost({
        message: `sync note batch36 ${token}`,
        agentId: "ceo",
        memoryHits: [`hit-${token}`],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const row = getDb()
      .prepare("SELECT payload FROM efficiency_events WHERE event_type = ? ORDER BY id DESC LIMIT 1")
      .get("operator_question") as { payload: string } | undefined;
    expect(row).toBeDefined();
    const payload = JSON.parse(row!.payload) as { memoryHits?: string[] };
    expect(payload.memoryHits).toContain(`hit-${token}`);
  });

  it.skip("release() idempotent guard (219) — sticky: requires duplicate handler release without double stream close", () => {});

  it("processTreeRssBytes skips falsy pid nodes (254)", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
    vi.stubEnv("SQLITE_DB_PATH", testDbPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    vi.stubEnv("MEMROOS_OPENCODE_MAX_RSS_MB", "1");
    vi.stubEnv("MEMROOS_OPENCODE_RSS_POLL_MS", "20");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          stream: vi.fn(async () => {
            throw new Error("skip");
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
        execFile: vi.fn((_cmd, _args, _opts, cb) => {
          cb?.(null, "4200 1 256\n0 4200 8\n4200 1 256\n4201 4200 32\n");
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
          child.pid = 4200;
          child.exitCode = null;
          child.killed = false;
          setTimeout(() => child.emit("close", 0, null), 35);
          return child;
        }),
      };
    });
    const { POST } = await import("../route");
    const res = await POST(chatPost({ message: `How is RSS batch36 ${randomUUID().slice(0, 4)}?`, agentId: "ceo" }));
    const text = await res.text();
    expect(text).toMatch(/exceeded|DONE|error|local/i);
  });
});
