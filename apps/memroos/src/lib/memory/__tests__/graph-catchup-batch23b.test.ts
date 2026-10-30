// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch23b — defaultLog, mem0 results, entity filter", () => {
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
  });

  it("defaultLog prints graph-catchup diagnostics when no custom log hook is supplied", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      sleep: async () => undefined,
      fetchVectorPage: async () => ({ items: [], nextCursor: null }),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[graph-catchup]"))).toBe(true);
    logSpy.mockRestore();
  });

  it("legacy mem0 fetch accepts top-level results arrays", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    delete process.env.QDRANT_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ id: "res-b23b", memory: "results wrapper", created_at: "2026-07-17T09:03:00.000Z" }],
        }),
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

  it("projectMemoryFact still projects facts when entity extraction is sparse", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-short-unknown",
        content: "Xy alone in the sentence.",
        source: "batch23b",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
