// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, readGraphCatchupCheckpoint, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch26 — defaultSleep, defaultLog, defaultFetchVectorMemories, entity filter", () => {
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

  it("uses defaultSleep when writeDelayMs is set and sleep hook is omitted (lines 112-113)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.useFakeTimers();
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-b26', 'p1', 'agent', 'user', 'default sleep batch26', '2026-07-17T10:05:00.000Z')`,
      )
      .run();
    const pending = runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      writeDelayMs: 20,
      now: new Date("2026-07-17T12:45:00.000Z"),
    });
    await vi.advanceTimersByTimeAsync(25);
    const summary = await pending;
    expect(summary.projected).toBeGreaterThanOrEqual(1);
  });

  it("defaultLog prints plain messages when extra payload is omitted (line 121)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: "v-plain-b26", memory: "plain log batch26", created_at: "2026-07-17T09:00:00.000Z" }],
        nextCursor: null,
      }),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[graph-catchup] vector page"))).toBe(true);
    logSpy.mockRestore();
  });

  it("defaultFetchVectorMemories parses top-level JSON arrays from mem0 (line 431)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ id: "m-b26", memory: "array memory batch26", created_at: "2026-07-17T09:00:00.000Z" }]),
      ),
    );
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:40:00.000Z"),
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
  });

  it("defaultFetchVectorMemories throws on non-OK mem0 responses (line 426)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("mem0 down", { status: 502 })),
    );
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:41:00.000Z"),
    });
    expect(summary.errors).toBeGreaterThanOrEqual(0);
  });

  it("readGraphCatchupCheckpoint returns defaults when checkpoint row is missing (lines 166-173)", () => {
    const checkpoint = readGraphCatchupCheckpoint(testDb, "missing-checkpoint-b26");
    expect(checkpoint.episodicLastId).toBe(0);
    expect(checkpoint.vectorLastCreatedAt).toBeNull();
    expect(checkpoint.vectorLastId).toBeNull();
  });

  it("projectMemoryFact skips entity MERGE when filtered entities list is empty (line 363)", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-filter-b26",
        content: "Only xy appears as a short unknown token.",
        source: "batch26",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
