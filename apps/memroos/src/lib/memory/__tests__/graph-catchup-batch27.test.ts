// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup, scrollQdrantPoints } from "../graph-catchup";

describe("graph-catchup batch27 — defaultLog extra, mem0 body shapes, entity filter", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("defaultLog includes structured extras on vector page logs (lines 117-118, 678-684)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 2,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: "v-extra-b27", memory: "vector extra batch27", created_at: "2026-07-17T09:00:00.000Z" }],
        nextCursor: null,
      }),
    });
    expect(
      logSpy.mock.calls.some(
        (call) => String(call[0]).includes("[graph-catchup] vector page") && call[1] && typeof call[1] === "object",
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it("defaultFetchVectorMemories reads memories envelope from mem0 (lines 429-431)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          memories: [{ id: "m-env-b27", memory: "memories key", created_at: "2026-07-17T09:00:00.000Z" }],
        }),
      ),
    );
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:50:00.000Z"),
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
  });

  it("defaultFetchVectorMemories reads results envelope from mem0 (line 430)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ id: "r-env-b27", memory: "results key", created_at: "2026-07-17T09:01:00.000Z" }],
        }),
      ),
    );
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:51:00.000Z"),
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
  });

  it("defaultFetchVectorMemories tolerates invalid JSON bodies via catch (line 428)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 3,
      dryRun: true,
      now: new Date("2026-07-17T12:52:00.000Z"),
    });
    expect(summary.sources.vector.considered).toBe(0);
  });

  it("projectMemoryFact skips entity MERGE when extracted entities are filtered out (line 363)", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-filter-b27",
        content: "Only xy and ab tokens appear.",
        source: "batch27",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("defaultSleep resolves when writeDelayMs is set without custom sleep hook (lines 112-113)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.useFakeTimers();
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-b27', 'p1', 'agent', 'user', 'default sleep batch27', '2026-07-17T10:05:00.000Z')`,
      )
      .run();
    const pending = runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      writeDelayMs: 15,
      now: new Date("2026-07-17T12:55:00.000Z"),
    });
    await vi.advanceTimersByTimeAsync(20);
    const summary = await pending;
    expect(summary.projected).toBeGreaterThanOrEqual(1);
  });

  it("scrollQdrantPoints returns empty items when Qdrant response lacks points (lines 477-482)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: {} })),
    );
    process.env.QDRANT_URL = "http://localhost:6333";
    const page = await scrollQdrantPoints(null, 5);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
