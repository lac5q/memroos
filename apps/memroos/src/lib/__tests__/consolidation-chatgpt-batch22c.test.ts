// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function stopScheduler() {
  const g = globalThis as { _consolidationInterval?: ReturnType<typeof setInterval> };
  if (g._consolidationInterval) {
    clearInterval(g._consolidationInterval);
    g._consolidationInterval = undefined;
  }
}

afterEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  stopScheduler();
  testDb.exec("DELETE FROM memory_meta_insights");
  testDb.exec("DELETE FROM memory_consolidation_runs");
  testDb.exec("DELETE FROM memory_salience");
  testDb.exec("DELETE FROM messages");
  delete process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES;
});

describe("memory-consolidation + chatgpt-actions batch22c", () => {
  beforeEach(() => {
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated)
         VALUES (?, 'p', 'a', 'user', ?, '2026-01-01T00:00:00Z', 0)`,
      )
      .run(`sess-${crypto.randomUUID()}`, "consolidate batch22c");
  });

  it("runConsolidation parses bracketed JSON with escaped quotes and honors provider backoff", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: {
            content: `Notes:\n[{"insight_type":"pattern","content":"escaped \\"quote\\" insight"}]\nDone.`,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { runConsolidation } = await import("../memory-consolidation");
    const ok = await runConsolidation();
    expect(ok.status).toBe("completed");
    expect(ok.insightsWritten).toBe(1);

    testDb.prepare(
      `INSERT INTO memory_consolidation_runs (batch_size, status, started_at, error_message)
       VALUES (0, 'failed', datetime('now'), 'HTTP 429 rate limit exceeded')`,
    ).run();
    process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES = "120";
    const skipped = await runConsolidation();
    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toBe("provider_rate_limited");
  });

  it("startConsolidationScheduler registers a single interval", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: { content: "[]" } }), { status: 200 }));
    const { startConsolidationScheduler, stopConsolidationScheduler } = await import("../memory-consolidation");
    startConsolidationScheduler();
    startConsolidationScheduler();
    expect((globalThis as { _consolidationInterval?: unknown })._consolidationInterval).toBeDefined();
    stopConsolidationScheduler();
  });
});

describe("chatgpt-actions batch22c", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("hostnameFromHostHeader, readJsonBody, and search normalization cover helper branches", async () => {
    vi.doMock("@/lib/constants", () => ({
      CLAUDE_MEMORY_PATH: "/tmp/claude-memory",
      MEM0_URL: "http://localhost:9999",
    }));
    vi.doMock("@/lib/memory/backends", () => ({
      searchVectorMemory: vi.fn(async () => [
        {
          memory: { content: "nested memory object", score: 0.5 },
          metadata: { visibility: "internal", policy: "agent_visible" },
        },
        { content: "plain content field", score: 0.4, metadata: { visibility: "internal", policy: "agent_visible" } },
      ]),
      queryGraphMemory: vi.fn(async () => ({
        results: [{ name: "node-a", summary: "graph hit", metadata: { visibility: "internal", policy: "agent_visible" } }],
      })),
    }));
    vi.doMock("@/lib/parsers", () => ({ parseClaudeMemory: vi.fn(async () => []) }));
    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        prepare: () => ({ get: () => null, all: () => [] }),
      }),
    }));
    vi.doMock("@/lib/memory/policy-gate", () => ({
      authorizeMemoryUse: () => ({ allowed: true }),
      extractMemoryLabelSnapshot: () => ({ visibility: "internal", policy: "agent_visible" }),
      filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
    }));
    vi.doMock("@/lib/security-policy", () => ({
      checkMemoryWritePolicy: () => ({ allowed: true }),
    }));
    vi.doMock("@/lib/privacy/pii-storage", () => ({
      protectMemoryPayloadForStorage: (payload: unknown) => payload,
    }));
    vi.doMock("@/lib/agent-registry", () => ({
      registerAgent: () => ({ agent: { id: "chatgpt-mobile" } }),
      recordMemoryWrite: () => {},
    }));
    vi.doMock("@/lib/audit", () => ({ writeAuditLog: () => {} }));
    const { authorizeChatGptAction, readJsonBody, searchMemroosForChatGpt } = await import("../chatgpt-actions");

    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "local-key";
    expect(
      authorizeChatGptAction(
        new Request("http://localhost/api/chatgpt/actions/search", {
          headers: { host: "[2001:db8::1]:3000", "x-api-key": "local-key" },
        }),
      ),
    ).toBeNull();

    const body = await readJsonBody(new Request("http://localhost/", { method: "POST", body: "[]" }));
    expect(body).toEqual({});

    const search = await searchMemroosForChatGpt(new Request("http://localhost/api/chatgpt/search"), 5);
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results.some((item) => item.text.includes("nested") || item.text.includes("plain"))).toBe(true);
  });
});
