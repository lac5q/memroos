// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch22d — default helpers and vector envelopes", () => {
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

  it("uses defaultSleep when catchup runs without a custom sleep hook", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const promise = runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: "v-sleep", memory: "tick", created_at: "2026-07-17T09:00:00.000Z" }],
        nextCursor: null,
      }),
    });
    await vi.runAllTimersAsync();
    await promise;
    logSpy.mockRestore();
  });

  it("legacy mem0 fetch accepts a top-level JSON array body", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    delete process.env.QDRANT_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ id: "arr-env", memory: "from array body", created_at: "2026-07-17T09:02:00.000Z" }]),
      ),
    );
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
  });

  it("projectMemoryFact skips entity MERGE when extracted entities filter to empty", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-unknown-only",
        content: "The word xyzzy appears alone.",
        source: "batch22d",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
