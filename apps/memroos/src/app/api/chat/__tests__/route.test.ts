// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let root: string;
let agentConfigsPath: string;
let pmoAgentsPath: string;
let pmoModelRoutingPath: string;
let testDbPath: string;

async function loadRoute() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("CONSOLIDATION_MODEL", "MiniMax-M2.7");
  return import("../chat-runtime");
}

async function loadPostRouteWithAnthropicFailure(errorMessage: string) {
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
          throw new Error(errorMessage);
        }),
      };
    },
  }));
  return import("../route");
}

async function loadPostRouteWithAnthropicFailureAndOpenCodeSuccess(errorMessage: string) {
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
          throw new Error(errorMessage);
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
        child.pid = 12345;
        child.exitCode = null;
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from("Qwen fallback response"));
          child.exitCode = 0;
          child.emit("close", 0, null);
        });
        return child;
      }),
    };
  });
  return import("../route");
}

async function loadPostRouteWithAnthropicSuccess() {
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
          yield {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Anthropic streamed reply" },
          };
        }),
      };
    },
  }));
  return import("../route");
}

async function loadPostRouteWithOpenCodeRssExceeded() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
  vi.stubEnv("MEMROOS_OPENCODE_MAX_RSS_MB", "1");
  vi.stubEnv("MEMROOS_OPENCODE_RSS_POLL_MS", "10");
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
      execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, callback?: (error: Error | null, stdout: string) => void) => {
        callback?.(null, "12345 1 2048000\n");
      }),
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          pid: number;
          exitCode: number | null;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 12345;
        child.exitCode = null;
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from("partial output before rss stop"));
        });
        setTimeout(() => {
          child.exitCode = null;
          child.emit("close", null, "SIGTERM");
        }, 40);
        return child;
      }),
    };
  });
  return import("../route");
}

async function loadPostRouteWithOpenCodeSpawnError(errorMessage: string) {
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
        child.pid = 24680;
        child.exitCode = null;
        queueMicrotask(() => {
          child.emit("error", new Error(errorMessage));
        });
        return child;
      }),
    };
  });
  return import("../route");
}

async function loadPostRouteWithOpenCodeBusySlot() {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
  vi.stubEnv("MEMROOS_OPENCODE_MAX_CONCURRENT", "1");
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
        child.pid = 54321;
        child.exitCode = null;
        return child;
      }),
    };
  });
  return import("../route");
}

async function loadPostRouteWithContextFailure(errorMessage: string) {
  vi.resetModules();
  vi.stubEnv("AGENT_CONFIGS_PATH", agentConfigsPath);
  vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoAgentsPath);
  vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoModelRoutingPath);
  vi.stubEnv("SQLITE_DB_PATH", testDbPath);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.doMock("../chat-runtime", async () => {
    const actual = await vi.importActual<typeof import("../chat-runtime")>("../chat-runtime");
    return {
      ...actual,
      buildAgentContext: vi.fn(async () => {
        throw new Error(errorMessage);
      }),
    };
  });
  return import("../route");
}

async function loadPostRouteWithOpenCodeFailure(errorMessage: string) {
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
        child.pid = 12345;
        child.exitCode = null;
        queueMicrotask(() => {
          child.stderr.emit("data", Buffer.from(errorMessage));
          child.exitCode = 1;
          child.emit("close", 1, null);
        });
        return child;
      }),
    };
  });
  return import("../route");
}

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
  registerAgent({
    ...input,
    protocol: "rest",
  });
}

describe("chat route model resolution", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "chat-route-"));
    agentConfigsPath = path.join(root, "knowledge-agents");
    pmoAgentsPath = path.join(root, "pmo-agents");
    pmoModelRoutingPath = path.join(root, "model-routing.yaml");
    testDbPath = path.join(root, "kitchen.db");
    mkdirSync(path.join(pmoAgentsPath, "ceo"), { recursive: true });
    mkdirSync(agentConfigsPath, { recursive: true });
    writeFileSync(
      path.join(pmoAgentsPath, "ceo", "AGENTS.md"),
      "# CEO\n\nYou run on Qwen/Bailian. You do NOT have MCP tool access.\n"
    );
    writeFileSync(
      pmoModelRoutingPath,
      [
        "rules:",
        "  - name: default",
        "    match: {}",
        "    tier: standard",
        "    preferred_model: qwen3.5",
        "",
      ].join("\n")
    );
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db");
    closeDb();
    vi.unstubAllEnvs();
    vi.doUnmock("@anthropic-ai/sdk");
    vi.doUnmock("child_process");
    vi.doUnmock("../chat-runtime");
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  });

  it("uses Paperclip/PMO agent instructions instead of the consolidation model", async () => {
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();

    const context = await buildAgentContext("ceo");
    const runtime = await resolveChatRuntime("ceo", context);

    expect(context.source).toBe("pmo");
    expect(context.agentInstructions).toContain("Qwen/Bailian");
    expect(runtime).toEqual({ runner: "opencode", model: "bailian/qwen3.5-plus" });
  });

  it("falls back to the PMO default routing model for PMO agents", async () => {
    mkdirSync(path.join(pmoAgentsPath, "marketing_qa"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "marketing_qa", "AGENTS.md"), "# Marketing QA\n");
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();

    const context = await buildAgentContext("marketing-qa");
    const runtime = await resolveChatRuntime("marketing-qa", context);

    expect(context.source).toBe("pmo");
    expect(runtime).toEqual({ runner: "opencode", model: "bailian/qwen3.5-plus" });
  });

  it("standardizes registered PMO agents on the PMO routing model before platform defaults", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n\nAlways-on async operations agent.\n");
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });

    const context = await buildAgentContext("alba");
    const runtime = await resolveChatRuntime("alba", context);

    expect(context.source).toBe("pmo");
    expect(runtime).toEqual({ runner: "opencode", model: "bailian/qwen3.5-plus" });
  });

  it("exposes a runtime plan with primary and fallback candidates", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n\nAlways-on async operations agent.\n");
    const { buildAgentContext, resolveChatRuntimePlan } = await loadRoute();
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });

    const context = await buildAgentContext("alba");
    const plan = await resolveChatRuntimePlan("alba", context);

    expect(plan.primary).toMatchObject({
      runner: "opencode",
      model: "bailian/qwen3.5-plus",
      source: "pmo-routing",
    });
    expect(plan.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ runner: "anthropic", source: "registered-platform" }),
    ]));
  });

  it("still routes registered OpenCode-class agents through OpenCode", async () => {
    mkdirSync(path.join(pmoAgentsPath, "qwen-engineer"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "qwen-engineer", "AGENTS.md"), "# Qwen Engineer\n");
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();
    await registerTestAgent({
      id: "qwen-engineer",
      name: "Qwen Engineer",
      role: "Engineering agent",
      platform: "qwen",
    });

    const context = await buildAgentContext("qwen-engineer");
    const runtime = await resolveChatRuntime("qwen-engineer", context);

    expect(runtime).toEqual({ runner: "opencode", model: "bailian/qwen3.5-plus" });
  });

  it("keeps PMO routing ahead of registered Claude name hints", async () => {
    mkdirSync(path.join(pmoAgentsPath, "claude-sonnet-engineer"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "claude-sonnet-engineer", "AGENTS.md"), "# Claude Sonnet Engineer\n");
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();
    await registerTestAgent({
      id: "claude-sonnet-engineer",
      name: "Claude Sonnet Engineer",
      role: "CLI engineer",
      platform: "claude",
    });

    const context = await buildAgentContext("claude-sonnet-engineer");
    const runtime = await resolveChatRuntime("claude-sonnet-engineer", context);

    expect(runtime).toEqual({ runner: "opencode", model: "bailian/qwen3.5-plus" });
  });

  it("keeps PMO routing ahead of registered Gemini platform hints", async () => {
    mkdirSync(path.join(pmoAgentsPath, "gemini-senior-engineer"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "gemini-senior-engineer", "AGENTS.md"), "# Gemini Senior Engineer\n");
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();
    await registerTestAgent({
      id: "gemini-senior-engineer",
      name: "Gemini Senior Engineer",
      role: "Engineering agent",
      platform: "gemini",
    });

    const context = await buildAgentContext("gemini-senior-engineer");
    const runtime = await resolveChatRuntime("gemini-senior-engineer", context);

    expect(runtime).toEqual({ runner: "opencode", model: "bailian/qwen3.5-plus" });
  });

  it("keeps memory consolidation model out of chat model selection", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf-8");

    expect(source).not.toContain("process.env.CONSOLIDATION_MODEL");
  });

  it("gates OpenCode execution behind an explicit operator flag", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf-8");

    expect(source).toContain('process.env.MEMROOS_ENABLE_OPENCODE === "true"');
    expect(source).toContain("OpenCode chat runner is disabled on this machine.");
  });

  it("keeps enabled OpenCode runs bounded by concurrency and RSS limits", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf-8");

    expect(source).toContain("MEMROOS_OPENCODE_MAX_CONCURRENT");
    expect(source).toContain("activeOpenCodeRuns");
    expect(source).toContain("MEMROOS_OPENCODE_MAX_RSS_MB");
    expect(source).toContain("OpenCode chat runner exceeded");
    expect(source).toContain("stopProcessGroup");
  });

  it("allows an explicit operator chat model override", async () => {
    vi.stubEnv("MEMROOS_CHAT_MODEL", "alibaba-coding-plan/qwen3.6-plus");
    const { buildAgentContext, resolveChatRuntime } = await loadRoute();

    const context = await buildAgentContext("ceo");
    const runtime = await resolveChatRuntime("ceo", context);

    expect(runtime).toEqual({ runner: "opencode", model: "alibaba-coding-plan/qwen3.6-plus" });
  });

  it("returns a local room check-in instead of failing when Anthropic quota is exhausted", async () => {
    await registerTestAgent({
      id: "claude-sonnet-engineer",
      name: "Claude Sonnet Engineer",
      role: "CLI engineer",
      platform: "claude",
    });
    const { POST } = await loadPostRouteWithAnthropicFailure("usage limit exceeded (2056)");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "claude-sonnet-engineer",
        message: "15-minute standup: yesterday, today, blockers",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Claude Sonnet Engineer local check-in");
    expect(text).toContain("Yesterday:");
    expect(text).toContain("Today:");
    expect(text).toContain("usage limit exceeded (2056)");
    expect(text).not.toContain("Chat unavailable");
  });

  it("falls through to an enabled OpenCode candidate when Anthropic is quota-blocked", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n\nmodel: claude-haiku-4-5\n");
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithAnthropicFailureAndOpenCodeSuccess("usage limit exceeded (2056)");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "alba",
        message: "test",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Qwen fallback response");
  });

  it("streams the in-product memory diagnostic for /doctor without invoking a provider", async () => {
    const { POST } = await loadPostRouteWithAnthropicFailure("provider should not run for /doctor");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "ceo",
        message: "/doctor",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Memory Doctor");
    expect(text).toContain("Status:");
    expect(text).toContain("Discord messages:");
    expect(text).toContain("product-owned NOC and memory health surfaces");
    expect(text).not.toContain("provider should not run for /doctor");
  });

  it("records operator question telemetry with deterministic memory hit correlation", async () => {
    await registerTestAgent({
      id: "claude-sonnet-engineer",
      name: "Claude Sonnet Engineer",
      role: "CLI engineer",
      platform: "claude",
    });
    const { POST } = await loadPostRouteWithAnthropicFailure("usage limit exceeded (2056)");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "claude-sonnet-engineer",
        taskId: "operator-reask-1",
        message: "Did we already check memory for the roadmap?",
        memoryHits: ["memory-117", "memory-114"],
        history: [
          { role: "user", content: "Did we already check memory for the roadmap?" },
          { role: "assistant", content: "Yes, Phase 117 follows the roadmap order." },
        ],
      }),
      headers: { "content-type": "application/json" },
    }));
    await readStream(res);

    const { getDb } = await import("@/lib/db");
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const events = listEfficiencyEvents(getDb(), {
      eventType: "operator_question",
      taskId: "operator-reask-1",
    });

    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "operator_question",
      taskId: "operator-reask-1",
      agentId: "claude-sonnet-engineer",
      payload: {
        questionText: "Did we already check memory for the roadmap?",
        memoryHits: ["memory-117", "memory-114"],
        priorAnswerMatch: true,
      },
    });
  });

  it("does not record operator question telemetry for non-question chat turns without memory hits", async () => {
    const { POST } = await loadPostRouteWithAnthropicFailure("usage limit exceeded (2056)");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "ceo",
        taskId: "operator-statement-1",
        message: "Please continue the current implementation slice.",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    await readStream(res);

    const { getDb } = await import("@/lib/db");
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const events = listEfficiencyEvents(getDb(), {
      eventType: "operator_question",
      taskId: "operator-statement-1",
    });

    expect(res.status).toBe(200);
    expect(events).toHaveLength(0);
  });

  it("returns 400 when the message is empty", async () => {
    const { POST } = await loadPostRouteWithAnthropicFailure("should not run");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ agentId: "ceo", message: "   ", history: [] }),
      headers: { "content-type": "application/json" },
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "message required" });
  });

  it("streams Anthropic text deltas when the primary runtime succeeds", async () => {
    mkdirSync(path.join(pmoAgentsPath, "claude-sonnet-engineer"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "claude-sonnet-engineer", "AGENTS.md"), "# Claude Sonnet Engineer\n");
    await registerTestAgent({
      id: "claude-sonnet-engineer",
      name: "Claude Sonnet Engineer",
      role: "CLI engineer",
      platform: "claude",
    });
    const { POST } = await loadPostRouteWithAnthropicSuccess();

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "claude-sonnet-engineer",
        message: "Summarize the current rollout status.",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Anthropic streamed reply");
  });

  it("returns a generic local fallback for non-standup turns when providers fail", async () => {
    await registerTestAgent({
      id: "claude-sonnet-engineer",
      name: "Claude Sonnet Engineer",
      role: "CLI engineer",
      platform: "claude",
    });
    const { POST } = await loadPostRouteWithAnthropicFailure("provider unavailable");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "claude-sonnet-engineer",
        message: "Give me a one-line status update.",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Claude Sonnet Engineer local response");
    expect(text).toContain("provider unavailable");
    expect(text).not.toContain("Yesterday:");
  });

  it("surfaces stream setup failures as SSE errors", async () => {
    const { POST } = await loadPostRouteWithContextFailure("agent context unavailable");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "ceo",
        message: "status check",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("agent context unavailable");
  });

  it("records operator question telemetry from memory_hits snake_case payloads", async () => {
    const { POST } = await loadPostRouteWithAnthropicFailure("usage limit exceeded (2056)");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "ceo",
        taskId: "operator-snake-1",
        message: "What changed in the rollout plan?",
        memory_hits: ["memory-201"],
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    await readStream(res);

    const { getDb } = await import("@/lib/db");
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const events = listEfficiencyEvents(getDb(), {
      eventType: "operator_question",
      taskId: "operator-snake-1",
    });

    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      memoryHits: ["memory-201"],
      priorAnswerMatch: false,
    });
  });

  it("mentions disabled OpenCode in the fallback reason when the runner flag is off", async () => {
    mkdirSync(path.join(pmoAgentsPath, "ceo"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "ceo", "AGENTS.md"), "# CEO\n");
    const { POST } = await loadPostRouteWithAnthropicFailure("provider unavailable");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "ceo",
        message: "status check",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("OpenCode runner is disabled");
    expect(text).toContain("MEMROOS_ENABLE_OPENCODE=true");
  });

  it("surfaces OpenCode runner stderr when the child exits non-zero", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n");
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithOpenCodeFailure("opencode model unavailable");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "alba",
        message: "status check",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("opencode model unavailable");
  });

  it("humanizes unregistered agent ids in the generic local fallback", async () => {
    const { POST } = await loadPostRouteWithAnthropicFailure("provider unavailable");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "beta_tester",
        message: "Give me a one-line status update.",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Beta Tester local response");
  });

  it("records operator question telemetry for question-like prompts without a question mark", async () => {
    const { POST } = await loadPostRouteWithAnthropicFailure("usage limit exceeded (2056)");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "ceo",
        taskId: "operator-what-1",
        message: "What changed in the rollout plan",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    await readStream(res);

    const { getDb } = await import("@/lib/db");
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const events = listEfficiencyEvents(getDb(), {
      eventType: "operator_question",
      taskId: "operator-what-1",
    });

    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      questionText: "What changed in the rollout plan",
      priorAnswerMatch: false,
    });
  });

  it("stops OpenCode when process-tree RSS exceeds the configured limit", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n");
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithOpenCodeRssExceeded();

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: "alba",
        message: "status check",
        history: [],
      }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toMatch(/exceeded 1MB RSS|partial output before rss stop/);
  });

  it("surfaces OpenCode spawn errors on the SSE stream", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n");
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithOpenCodeSpawnError("spawn EACCES");

    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ agentId: "alba", message: "status check", history: [] }),
      headers: { "content-type": "application/json" },
    }));
    const text = await readStream(res);

    expect(res.status).toBe(200);
    expect(text).toContain("spawn EACCES");
  });

  it("returns a busy error when OpenCode concurrency is saturated", async () => {
    mkdirSync(path.join(pmoAgentsPath, "alba"), { recursive: true });
    writeFileSync(path.join(pmoAgentsPath, "alba", "AGENTS.md"), "# Alba\n");
    await registerTestAgent({
      id: "alba",
      name: "Alba",
      role: "Head Chef",
      platform: "hermes",
    });
    const { POST } = await loadPostRouteWithOpenCodeBusySlot();

    const first = POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ agentId: "alba", message: "first", history: [] }),
      headers: { "content-type": "application/json" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const secondRes = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ agentId: "alba", message: "second", history: [] }),
      headers: { "content-type": "application/json" },
    }));
    const secondText = await readStream(secondRes);

    expect(secondRes.status).toBe(200);
    expect(secondText).toMatch(/OpenCode chat runner is busy/);
    await first;
  }, 10_000);
});
