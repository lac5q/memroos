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

describe("memory-consolidation batch28b — insight filter, empty batch, provider errors", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    delete process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES;
    testDb.exec("DELETE FROM memory_meta_insights");
    testDb.exec("DELETE FROM memory_consolidation_runs");
    testDb.exec("DELETE FROM memory_salience");
    testDb.exec("DELETE FROM messages");
  });

  it("filters disallowed insight_type values and still completes the run", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOllamaResponse(
        '[{"insight_type":"pattern","content":"ok b28b"},{"insight_type":"novelty","content":"skip"},{"insight_type":"summary","content":""}]',
      ),
    );
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-b28b", "p1", "agent", "user", "msg filter types", "2024-01-01T00:00:00Z");
    testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.status).toBe("completed");
    expect(result.insightsWritten).toBe(1);
    const row = testDb.prepare("SELECT consolidated FROM messages LIMIT 1").get() as { consolidated: number };
    expect(row.consolidated).toBe(1);
  });

  it("returns completed with zero batch when no unconsolidated messages exist", async () => {
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result).toMatchObject({ status: "completed", batchSize: 0, insightsWritten: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("marks run failed when Ollama responds with non-OK status", async () => {
    mockFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429, statusText: "Too Many Requests" }));
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-fail-b28b", "p1", "agent", "user", "msg ollama fail", "2024-01-01T00:00:00Z");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/429/);
  });

  it("does not enter provider backoff when CONSOLIDATION_PROVIDER_BACKOFF_MINUTES is zero", async () => {
    process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES = "0";
    testDb.prepare(
      `INSERT INTO memory_consolidation_runs(status, batch_size, insights_written, started_at, error_message)
       VALUES ('failed', 0, 0, ?, '429 rate limit exceeded')`,
    ).run(new Date().toISOString());
    mockFetch.mockResolvedValueOnce(mockOllamaResponse("[]"));
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-backoff-b28b", "p1", "agent", "user", "msg backoff off", "2024-01-01T00:00:00Z");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.status).not.toBe("skipped");
    expect(mockFetch).toHaveBeenCalled();
  });
});
