// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let root: string;
let agentConfigsPath: string;
let pmoAgentsPath: string;
let pmoModelRoutingPath: string;
let testDbPath: string;

async function readStream(response: Response): Promise<string> {
  const raw = await response.text();
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as { text?: string; error?: string })
    .map((payload) => payload.text ?? payload.error ?? "")
    .join("");
}

async function registerTestAgent(input: {
  id: string;
  name: string;
  role: string;
  platform: "claude" | "codex" | "qwen" | "gemini" | "opencode" | "hermes" | "openclaw" | "chatgpt";
}) {
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  const { registerAgent } = await import("@/lib/agent-registry");
  registerAgent({ ...input, protocol: "rest" });
}

async function loadPostRouteWithExecFileErrorAndOpenCodeHang() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
  vi.stubEnv("MEMROOS_OPENCODE_RSS_POLL_MS", "15");
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(async () => {
          throw new Error("anthropic should not run");
        }),
      };
    },
  }));
  vi.doMock("child_process", async () => {
    const { EventEmitter } = await import("events");
    return {
      execFile: vi.fn(
        (_cmd: string, _args: string[], _opts: unknown, callback?: (error: Error | null, stdout: string) => void) => {
          callback?.(new Error("ps failed"), "");
        }
      ),
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          pid: number;
          exitCode: number | null;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 99999;
        child.exitCode = null;
        return child;
      }),
    };
  });
  return import("../chat/route");
}

async function loadPostRouteWithOpenCodeTimeout() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
  vi.stubEnv("MEMROOS_CHAT_TIMEOUT_MS", "30");
  vi.stubEnv("MEMROOS_OPENCODE_KILL_GRACE_MS", "5");
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(async () => {
          throw new Error("anthropic should not run");
        }),
      };
    },
  }));
  vi.doMock("child_process", async () => {
    const { EventEmitter } = await import("events");
    const kill = vi.fn();
    return {
      execFile: vi.fn(),
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          pid: number;
          exitCode: number | null;
          kill: typeof kill;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 88888;
        child.exitCode = null;
        child.kill = kill;
        setTimeout(() => {
          child.exitCode = 1;
          child.emit("close", 1, "SIGTERM");
        }, 50);
        return child;
      }),
    };
  });
  return import("../chat/route");
}

async function loadPostRouteWithLongStderr() {
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
          throw new Error("anthropic should not run");
        }),
      };
    },
  }));
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
        child.pid = 77777;
        child.exitCode = null;
        queueMicrotask(() => {
          child.stderr.emit("data", Buffer.from("x".repeat(2500)));
          child.exitCode = 1;
          child.emit("close", 1, null);
        });
        return child;
      }),
    };
  });
  return import("../chat/route");
}

async function loadPostRouteWithBlockedCandidateThenAnthropicFail() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.doMock("@/app/api/chat/chat-runtime", async () => {
    const actual = await vi.importActual<typeof import("@/app/api/chat/chat-runtime")>(
      "@/app/api/chat/chat-runtime"
    );
    return {
      ...actual,
      resolveChatRuntimePlan: vi.fn(async () => ({
        primary: { runner: "opencode", model: "blocked/model", source: "test" },
        candidates: [
          { runner: "opencode", model: "blocked/model", source: "test" },
          { runner: "anthropic", model: "claude-test", source: "test" },
        ],
      })),
      chatRuntimeStatus: vi.fn((runtime: { runner: string }) =>
        runtime.runner === "opencode"
          ? { status: "blocked", detail: "runner unavailable" }
          : { status: "ready", detail: "ok" }
      ),
    };
  });
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      };
    },
  }));
  return import("../chat/route");
}

async function loadPostRouteWithMemoryHitsOnlyTelemetry() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(async () => {
          throw new Error("usage limit exceeded (2056)");
        }),
      };
    },
  }));
  return import("../chat/route");
}

describe("batch14b — /api/chat extended branches", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "chat-batch14b-"));
    agentConfigsPath = path.join(root, "knowledge-agents");
    pmoAgentsPath = path.join(root, "pmo-agents");
    pmoModelRoutingPath = path.join(root, "model-routing.yaml");
    testDbPath = path.join(root, "kitchen.db");
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    mkdirSync(agentConfigsPath, { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n");
    writeFileSync(
      pmoModelRoutingPath,
      ["rules:", "  - name: default", "    match: {}", "    tier: standard", "    preferred_model: qwen3.5", ""].join("\n")
    );
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db");
    closeDb();
    vi.unstubAllEnvs();
    vi.doUnmock("@anthropic-ai/sdk");
    vi.doUnmock("child_process");
    vi.doUnmock("@/app/api/chat/chat-runtime");
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  });

  it("continues past blocked OpenCode candidates and surfaces failure in fallback", async () => {
    await registerTestAgent({
      id: "claude-sonnet-engineer",
      name: "Claude Sonnet Engineer",
      role: "CLI engineer",
      platform: "claude",
    });
    const { POST } = await loadPostRouteWithBlockedCandidateThenAnthropicFail();
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          agentId: "claude-sonnet-engineer",
          message: "status check",
          history: [],
        }),
        headers: { "content-type": "application/json" },
      })
    );
    const text = await readStream(res);
    expect(res.status).toBe(200);
    expect(text).toContain("runner unavailable");
    expect(text).toContain("local response");
  });

  it("records operator_question telemetry when memory hits are present without a question mark", async () => {
    await registerTestAgent({
      id: "ceo",
      name: "CEO",
      role: "Operator",
      platform: "claude",
    });
    const { POST } = await loadPostRouteWithMemoryHitsOnlyTelemetry();
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          agentId: "ceo",
          taskId: "batch14b-memory-hits",
          message: "Continue with memory context attached.",
          memoryHits: ["memory-901"],
          history: [],
        }),
        headers: { "content-type": "application/json" },
      })
    );
    await readStream(res);

    const { getDb } = await import("@/lib/db");
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const events = listEfficiencyEvents(getDb(), {
      eventType: "operator_question",
      taskId: "batch14b-memory-hits",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      memoryHits: ["memory-901"],
      priorAnswerMatch: false,
    });
  });

  it("survives RSS polling when ps execFile fails (treats RSS as zero)", async () => {
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithExecFileErrorAndOpenCodeHang();
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ agentId: "alba", message: "hang test", history: [] }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(res.body).toBeTruthy();
  });

  it("truncates very long OpenCode stderr before surfacing exit errors", async () => {
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithLongStderr();
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ agentId: "alba", message: "stderr test", history: [] }),
        headers: { "content-type": "application/json" },
      })
    );
    const text = await readStream(res);
    expect(res.status).toBe(200);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/x+/);
  });

  it("terminates hung OpenCode runs after MEMROOS_CHAT_TIMEOUT_MS", async () => {
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithOpenCodeTimeout();
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ agentId: "alba", message: "timeout test", history: [] }),
        headers: { "content-type": "application/json" },
      })
    );
    const text = await readStream(res);
    expect(res.status).toBe(200);
    expect(text).toMatch(/chat runner stopped|SIGTERM|exited with code/i);
  }, 5_000);
});
