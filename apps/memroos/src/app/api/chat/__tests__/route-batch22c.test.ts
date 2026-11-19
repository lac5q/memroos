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
  root = mkdtempSync(path.join(tmpdir(), `chat-b22c-${randomUUID()}-`));
  agentConfigsPath = path.join(root, "agent-configs");
  pmoAgentsPath = path.join(root, "pmo-agents");
  pmoModelRoutingPath = path.join(root, "model-routing.json");
  testDbPath = path.join(root, "chat.db");
  mkdirSync(path.join(agentConfigsPath, "ceo"), { recursive: true });
  writeFileSync(path.join(agentConfigsPath, "ceo", "SOUL.md"), "CEO soul batch22c.");
  writeFileSync(
    pmoModelRoutingPath,
    JSON.stringify({ defaults: { anthropic: "claude-test" }, agents: {} }),
    "utf8",
  );
}

describe("POST /api/chat batch22c", () => {
  beforeEach(async () => {
    await seedAgentLayout();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.doUnmock("child_process");
    vi.doUnmock("@anthropic-ai/sdk");
    vi.resetModules();
  });

  it("records operator_question telemetry for how-prefixed prompts without a question mark", async () => {
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
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok batch22c" } };
          }),
        };
      },
    }));
    const { POST } = await import("../route");
    const { getDb } = await import("@/lib/db");
    const res = await POST(
      chatPost({
        message: "how are deployments trending",
        agentId: "ceo",
        memory_hits: ["mem-batch22c"],
        history: [{ role: "user", content: "how are deployments trending" }],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const row = getDb()
      .prepare("SELECT payload FROM efficiency_events WHERE event_type = ? ORDER BY id DESC LIMIT 1")
      .get("operator_question") as { payload: string } | undefined;
    expect(row?.payload).toBeTruthy();
    const payload = JSON.parse(row!.payload) as { priorAnswerMatch?: boolean };
    expect(payload.priorAnswerMatch).toBe(true);
  });

});
