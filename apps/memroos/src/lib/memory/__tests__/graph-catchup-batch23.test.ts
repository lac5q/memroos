// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch23 — defaultLog, legacy fetch, entity filter", () => {
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

  it("defaultLog prints vector page diagnostics when no custom log hook is supplied", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 2,
      dryRun: true,
      sleep: async () => undefined,
      fetchVectorPage: async () => ({
        items: [
          { id: "v1", memory: "one", created_at: "2026-07-17T09:00:00.000Z" },
          { id: "v2", memory: "two", created_at: "2026-07-17T09:01:00.000Z" },
        ],
        nextCursor: null,
      }),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("vector page"))).toBe(true);
    logSpy.mockRestore();
  });

  it("legacy mem0 fetch accepts top-level JSON array responses", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    delete process.env.QDRANT_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ id: "arr-b23", memory: "legacy array body", created_at: "2026-07-17T09:02:00.000Z" }]),
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

  it("projectMemoryFact skips entity MERGE when filtered entities list is empty", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const outcome = await projectMemoryFact(
      {
        id: "fact-unknown-only",
        content: "The word xyzzy appears alone.",
        source: "batch23",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
