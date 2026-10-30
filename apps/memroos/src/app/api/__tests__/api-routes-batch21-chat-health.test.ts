// @vitest-environment node
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockBuildAgentContext = vi.fn();
const mockResolveChatRuntimePlan = vi.fn();
const mockChatRuntimeStatus = vi.fn();
const mockCheckGraphHealth = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/backends", () => ({
  checkGraphHealth: (...args: unknown[]) => mockCheckGraphHealth(...args),
}));

vi.mock("@/app/api/chat/chat-runtime", () => ({
  buildAgentContext: (...args: unknown[]) => mockBuildAgentContext(...args),
  resolveChatRuntimePlan: (...args: unknown[]) => mockResolveChatRuntimePlan(...args),
  chatRuntimeStatus: (...args: unknown[]) => mockChatRuntimeStatus(...args),
  resolveChatRuntime: vi.fn(async () => ({ runner: "anthropic", model: "claude-test", source: "env" })),
  isProviderLimitError: vi.fn(() => false),
  recordChatRuntimeFailure: vi.fn(),
  recordChatRuntimeSuccess: vi.fn(),
}));

const LOOPBACK = "http://localhost";

function jsonBody(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockBuildAgentContext.mockReset();
  mockResolveChatRuntimePlan.mockReset();
  mockChatRuntimeStatus.mockReset();
  mockCheckGraphHealth.mockReset();
  mockBuildAgentContext.mockResolvedValue({ systemPrompt: "You are an agent.", agentInstructions: null, source: "fallback" });
  mockCheckGraphHealth.mockResolvedValue({ tier: "graph", backend: "neo4j", status: "up" });
  delete process.env.MEMROOS_ENABLE_OPENCODE;
  delete process.env.MEMROOS_CHAT_MODEL;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("api routes batch21 — chat route opencode branches", () => {
  it("POST skips disabled OpenCode runner and falls back to Anthropic stream", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockResolveChatRuntimePlan.mockResolvedValue({
      primary: { runner: "opencode", model: "qwen/test", source: "registered-platform", detail: "qwen" },
      candidates: [
        { runner: "opencode", model: "qwen/test", source: "registered-platform", detail: "qwen" },
        { runner: "anthropic", model: "claude-test", source: "default", detail: "default" },
      ],
    });
    mockChatRuntimeStatus.mockImplementation((runtime: { runner: string }) =>
      runtime.runner === "opencode"
        ? { status: "ready", detail: "would run opencode" }
        : { status: "ready", detail: "anthropic ready" },
    );

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          stream: vi.fn(async function* () {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "hello batch21" } };
          }),
        };
      },
    }));

    const { POST } = await import("../chat/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/chat`, { message: "ping batch21", agentId: "ceo" }) as NextRequest);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("hello batch21");
    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("POST records failure when OpenCode is disabled and no fallback succeeds", async () => {
    mockResolveChatRuntimePlan.mockResolvedValue({
      primary: { runner: "opencode", model: "qwen/test", source: "env", detail: "only opencode" },
      candidates: [{ runner: "opencode", model: "qwen/test", source: "env", detail: "only opencode" }],
    });
    mockChatRuntimeStatus.mockReturnValue({ status: "ready", detail: "ready" });

    const { POST } = await import("../chat/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/chat`, { message: "opencode only", agentId: "ceo" }) as NextRequest);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/disabled on this machine/i);
  });
});

describe("api routes batch21 — health knowledge index cache", () => {
  it("GET /api/health reuses knowledge index cache within TTL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", vector_store: "connected", queue: { queued: 0 } }),
      })),
    );

    let scriptRuns = 0;
    vi.doMock("child_process", () => ({
      execFile: (
        file: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string) => void,
      ) => {
        if (args[0] === "qmd") {
          cb(null, "/usr/bin/qmd");
          return;
        }
        if (String(args[0]).includes("check-knowledge-indexing.mjs")) {
          scriptRuns += 1;
          cb(null, JSON.stringify({ ok: true, pendingEmbeddings: 0 }));
          return;
        }
        if (args[0] === "--version") {
          cb(new Error("rtk missing"));
          return;
        }
        cb(new Error(`unexpected exec ${file} ${args.join(" ")}`));
      },
    }));

    vi.stubEnv("KNOWLEDGE_INDEX_HEALTH_TTL_MS", `${60_000}`);
    const { GET } = await import("../health/route");
    await GET();
    await GET();
    expect(scriptRuns).toBe(1);
    vi.doUnmock("child_process");
  });

  it("GET /api/health returns running detail when knowledge check exceeds request timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", vector_store: "connected", queue: { queued: 0 } }),
      })),
    );

    vi.doMock("child_process", () => ({
      execFile: (
        _file: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string) => void,
      ) => {
        if (args[0] === "qmd") {
          cb(null, "/usr/bin/qmd");
          return;
        }
        if (String(args[0]).includes("check-knowledge-indexing.mjs")) {
          setTimeout(() => cb(null, JSON.stringify({ ok: true, pendingEmbeddings: 1 })), 50);
          return;
        }
        if (args[0] === "--version") {
          cb(new Error("rtk missing"));
          return;
        }
        cb(new Error("unexpected"));
      },
    }));

    vi.stubEnv("KNOWLEDGE_INDEX_HEALTH_REQUEST_TIMEOUT_MS", "5");
    vi.resetModules();
    const { GET } = await import("../health/route");
    const body = await (await GET()).json();
    const knowledge = body.services.find((s: { service: string }) => s.service === "Knowledge Index");
    expect(knowledge?.detail).toMatch(/running/i);
    vi.doUnmock("child_process");
  });
});
