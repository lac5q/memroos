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

describe("memory-consolidation batch24 — parse branches and scheduler stop", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    testDb.exec("DELETE FROM memory_meta_insights");
    testDb.exec("DELETE FROM memory_consolidation_runs");
    testDb.exec("DELETE FROM memory_salience");
    testDb.exec("DELETE FROM messages");
  });

  it("does not mark messages consolidated when LLM returns a non-array JSON object", async () => {
    mockFetch.mockResolvedValueOnce(mockOllamaResponse('{"insight_type":"pattern","content":"ignored object"}'));
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-b24", "p1", "agent", "user", "msg object", "2024-01-01T00:00:00Z");
    testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result).toMatchObject({ status: "completed", insightsWritten: 0 });
    const row = testDb.prepare("SELECT consolidated FROM messages LIMIT 1").get() as { consolidated: number };
    expect(row.consolidated).toBe(0);
  });

  it("extractFirstJsonArray path accepts JSON embedded in prose", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOllamaResponse('Here are insights:\n[{"insight_type":"summary","content":"embedded array batch24"}]\nThanks.'),
    );
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-b24b", "p1", "agent", "user", "msg prose", "2024-01-01T00:00:00Z");
    testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result).toMatchObject({ status: "completed", insightsWritten: 1 });
  });

  it("stopConsolidationScheduler clears the global interval handle", async () => {
    const { startConsolidationScheduler, stopConsolidationScheduler } = await import("@/lib/memory-consolidation");
    startConsolidationScheduler();
    expect(globalThis._consolidationInterval).toBeDefined();
    stopConsolidationScheduler();
    expect(globalThis._consolidationInterval).toBeUndefined();
  });
});
