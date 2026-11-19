// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch22 — defaultLog extras, mem0 shapes, incremental page cap", () => {
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

  it("defaultLog prints structured extras during vector paging", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 2,
      dryRun: true,
      now: new Date("2026-07-17T12:50:00.000Z"),
      fetchVectorPage: async () => ({
        items: [{ id: "v-log", memory: "logged vector item", created_at: "2026-07-17T09:00:00.000Z" }],
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

  it("legacy mem0 fetch accepts memories[] envelope", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    delete process.env.QDRANT_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          memories: [{ id: "m-env", memory: "from memories key", created_at: "2026-07-17T09:00:00.000Z" }],
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

  it("legacy mem0 fetch accepts results[] envelope", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    delete process.env.QDRANT_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ id: "r-env", memory: "from results key", created_at: "2026-07-17T09:01:00.000Z" }],
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

  it("incremental vector catchup stops after the first paged cursor", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    let pageCalls = 0;
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: false,
      batchSize: 3,
      dryRun: true,
      now: new Date("2026-07-17T12:55:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
      fetchVectorPage: async (cursor) => {
        pageCalls += 1;
        if (!cursor) {
          return {
            items: [{ id: "inc-1", memory: "page one", created_at: "2026-07-17T09:00:00.000Z" }],
            nextCursor: "page-2-should-not-run",
          };
        }
        return { items: [], nextCursor: null };
      },
    });
    expect(pageCalls).toBe(1);
    expect(summary.pages).toBe(1);
  });

  it("projectMemoryFact skips entity MERGE when filtered entities list is empty", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-filtered-entities",
        content: "x",
        source: "batch22",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
