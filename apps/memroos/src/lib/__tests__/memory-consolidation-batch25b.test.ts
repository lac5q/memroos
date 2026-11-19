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

describe("memory-consolidation batch25b — empty transcript guard", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    testDb.exec("DELETE FROM memory_meta_insights");
    testDb.exec("DELETE FROM memory_consolidation_runs");
    testDb.exec("DELETE FROM memory_salience");
    testDb.exec("DELETE FROM messages");
  });

  it("runConsolidation completes with zero insights when no salient messages exist", async () => {
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result).toMatchObject({ status: "completed", insightsWritten: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("runConsolidation skips malformed JSON arrays from the model", async () => {
    mockFetch.mockResolvedValueOnce(mockOllamaResponse("[] trailing prose is not valid top-level"));
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-b25b", "p1", "agent", "user", "msg", "2024-01-01T00:00:00Z");
    testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.insightsWritten).toBe(0);
  });
});
