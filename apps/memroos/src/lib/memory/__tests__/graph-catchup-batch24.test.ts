// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch24 — default fetch failures and entity filter", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses defaultSleep when writeDelayMs is set and sleep hook is omitted", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.useFakeTimers();
    const promise = runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      writeDelayMs: 5,
      fetchVectorPage: async () => ({
        items: [{ id: "v-b24", memory: "sleep tick", created_at: "2026-07-17T09:00:00.000Z" }],
        nextCursor: null,
      }),
    });
    await vi.runAllTimersAsync();
    await promise;
  });

  it("legacy mem0 fetch surfaces HTTP failures and empty envelope bodies", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    delete process.env.QDRANT_URL;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("fail", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const failed = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 3,
      dryRun: true,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(failed.sources.vector.errors).toBeGreaterThan(0);

    const emptyBody = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 3,
      dryRun: true,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(emptyBody.sources.vector.considered).toBe(0);
  });

  it("projectMemoryFact skips entity MERGE when extracted entities filter to empty", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-filter-b24",
        content: "Only xy appears as a short unknown token.",
        source: "batch24",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
