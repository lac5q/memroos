// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  countNeo4jNodes,
  isNeo4jConfigured,
  projectMemoryFact,
  runGraphCatchup,
} from "../graph-catchup";

describe("graph-catchup batch28 — neo4j skip, entity catch, mem0 array, qdrant error, episodic skip", () => {
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
  });

  it("runGraphCatchup skips when Neo4j is not configured and dryRun is false (lines 554-557)", async () => {
    delete process.env.NEO4J_PASSWORD;
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: false,
    });
    expect(summary.status).toBe("skipped");
    expect(summary.reason).toBe("neo4j_not_configured");
  });

  it("projectMemoryFact swallows entity projection failures after fact MERGE (lines 407-414)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ results: [{ data: [{ row: ["fact-b28"] }] }], errors: [] })
      .mockRejectedValueOnce(new Error("entity merge failed batch28"));

    const outcome = await projectMemoryFact(
      {
        id: "fact-entity-catch-b28",
        content: "Meet Acme Corp in Seattle for API review.",
        source: "vector",
        agentId: "agent",
        createdAt: "2026-07-17T11:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("entity projection failed"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("runGraphCatchup skips episodic rows with empty content (lines 585-587)", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j";
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-b28', 'p1', 'agent', 'user', '   ', '2026-07-17T10:10:00.000Z')`,
      )
      .run();
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:58:00.000Z"),
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.sources.episodic.considered).toBe(0);
  });

  it("countNeo4jNodes coerces string counts from Neo4j HTTP (lines 341-342)", async () => {
    const queryFn = vi.fn(async () => ({
      results: [{ data: [{ row: ["42"] }] }],
      errors: [],
    }));
    await expect(countNeo4jNodes(queryFn as never)).resolves.toBe(42);
  });

  it("defaultFetchVectorMemories accepts top-level JSON array bodies (line 431)", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ id: "arr-b28", memory: "array envelope batch28", created_at: "2026-07-17T09:02:00.000Z" }]),
      ),
    );
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      useQdrantScroll: false,
      now: new Date("2026-07-17T12:59:00.000Z"),
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
  });

  it("isNeo4jConfigured treats whitespace-only passwords as unset (lines 126-127)", () => {
    expect(isNeo4jConfigured({ password: "   " })).toBe(false);
    expect(isNeo4jConfigured({ password: "test-neo4j" })).toBe(true);
  });

  it("runGraphCatchup records vector projection errors from fetchVectorPage (lines 667-672)", async () => {
    process.env.NEO4J_PASSWORD = "test-neo4j";
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: false,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: "vec-err-b28", memory: "vector error batch28", created_at: "2026-07-17T09:05:00.000Z" }],
        nextCursor: null,
      }),
      projectFact: async () => {
        throw new Error("vector project failed batch28");
      },
      now: new Date("2026-07-17T13:00:00.000Z"),
    });
    expect(summary.sources.vector.errors).toBeGreaterThanOrEqual(1);
    expect(summary.errorSamples?.some((s) => s.includes("vector project failed batch28"))).toBe(true);
  });
});
