// @vitest-environment node
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDb = new Database(":memory:");

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

afterAll(() => {
  testDb.close();
});

function mockOllamaResponse(content: string) {
  return Promise.resolve(
    new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("memory-consolidation batch27 — array extraction and provider backoff", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    delete process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES;
    testDb.exec("DELETE FROM memory_meta_insights");
    testDb.exec("DELETE FROM memory_consolidation_runs");
    testDb.exec("DELETE FROM memory_salience");
    testDb.exec("DELETE FROM messages");
  });

  it("runConsolidation handles unclosed JSON arrays without marking messages consolidated", async () => {
    mockFetch.mockResolvedValueOnce(mockOllamaResponse('[{"insight_type":"summary","content":"broken'));
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-b27", "p1", "agent", "user", "msg broken array", "2024-01-01T00:00:00Z");
    testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.insightsWritten).toBe(0);
    const row = testDb.prepare("SELECT consolidated FROM messages LIMIT 1").get() as { consolidated: number };
    expect(row.consolidated).toBe(0);
  });

  it("runConsolidation skips work while provider backoff is active after rate-limit failures", async () => {
    process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES = "120";
    testDb.prepare(
      `INSERT INTO memory_consolidation_runs(status, batch_size, insights_written, started_at, error_message)
       VALUES ('failed', 0, 0, ?, '429 rate limit exceeded')`,
    ).run(new Date().toISOString());
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("provider_rate_limited");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("startConsolidationScheduler registers a single interval per process", async () => {
    const { startConsolidationScheduler, stopConsolidationScheduler } = await import("@/lib/memory-consolidation");
    startConsolidationScheduler();
    const first = globalThis._consolidationInterval;
    startConsolidationScheduler();
    expect(globalThis._consolidationInterval).toBe(first);
    stopConsolidationScheduler();
    expect(globalThis._consolidationInterval).toBeUndefined();
  });
});
