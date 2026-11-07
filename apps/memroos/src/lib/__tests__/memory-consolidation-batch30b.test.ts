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

afterAll(() => testDb.close());

describe("memory-consolidation batch30b", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    delete process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES;
    testDb.exec("DELETE FROM memory_consolidation_runs");
    testDb.exec("DELETE FROM messages");
    testDb.exec("DELETE FROM memory_salience");
  });

  it("ignores provider backoff when failure started_at is not finite", async () => {
    process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES = "120";
    testDb.prepare(
      `INSERT INTO memory_consolidation_runs(status, batch_size, insights_written, started_at, error_message)
       VALUES ('failed', 0, 0, 'not-a-date', '429 rate limit exceeded')`,
    ).run();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { content: "[]" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.status).not.toBe("skipped");
  });

  it("allows consolidation after backoff window expires", async () => {
    process.env.CONSOLIDATION_PROVIDER_BACKOFF_MINUTES = "1";
    const old = new Date(Date.now() - 2 * 60_000).toISOString();
    testDb.prepare(
      `INSERT INTO memory_consolidation_runs(status, batch_size, insights_written, started_at, error_message)
       VALUES ('failed', 0, 0, ?, '429 rate limit exceeded')`,
    ).run(old);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { content: "[]" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const result = await runConsolidation();
    expect(result.status).not.toBe("skipped");
  });

  it("scheduler interval invokes another consolidation cycle", async () => {
    vi.useFakeTimers();
    testDb
      .prepare(
        "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated) VALUES(?,?,?,?,?,?,0)",
      )
      .run("sess-b30b", "p", "agent", "user", "hello batch30b", "2024-01-01T00:00:00Z");
    testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "[]" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { startConsolidationScheduler, stopConsolidationScheduler } = await import("@/lib/memory-consolidation");
    startConsolidationScheduler();
    const runsBefore = (
      testDb.prepare("SELECT COUNT(*) AS c FROM memory_consolidation_runs").get() as { c: number }
    ).c;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    const runsAfter = (
      testDb.prepare("SELECT COUNT(*) AS c FROM memory_consolidation_runs").get() as { c: number }
    ).c;
    expect(runsAfter).toBeGreaterThan(runsBefore);
    stopConsolidationScheduler();
    vi.useRealTimers();
  });
});
