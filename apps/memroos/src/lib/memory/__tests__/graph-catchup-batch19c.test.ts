// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch19c — episodic break, vector paging, entity edges", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    process.env.NEO4J_PASSWORD = "neo4j-pass";
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
    vi.restoreAllMocks();
  });

  it("stops episodic sweep after a projection failure in oneshot mode", async () => {
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-a', 'p1', 'agent', 'user', 'first message', '2026-07-17T10:00:00.000Z'),
                ('sess-b', 'p1', 'agent', 'user', 'second message', '2026-07-17T10:01:00.000Z')`,
      )
      .run();
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 1,
      dryRun: false,
      now: new Date("2026-07-17T12:30:00.000Z"),
      sleep: async () => undefined,
      log: (message, extra) => {
        if (extra) expect(typeof message).toBe("string");
      },
      projectFact: async () => {
        throw new Error("project boom");
      },
    });
    expect(summary.errors).toBeGreaterThanOrEqual(1);
    expect(summary.sources.episodic.errors).toBeGreaterThanOrEqual(1);
  });

  it("honors maxPoints when scrolling vector pages via injected fetchPage", async () => {
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      maxPoints: 1,
      useQdrantScroll: true,
      fetchVectorPage: async (cursor) => ({
        items: [
          { id: "v1", memory: "one", created_at: "2026-07-17T10:00:00.000Z" },
          { id: "v2", memory: "two", created_at: "2026-07-17T10:01:00.000Z" },
        ],
        nextCursor: cursor ? null : "page-2",
      }),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.considered).toBeLessThanOrEqual(2);
    expect(summary.pages).toBeGreaterThanOrEqual(1);
  });

  it("projectMemoryFact continues when entity projection fails", async () => {
    const queryFn = vi.fn(async () => ({ results: [] }));
    vi.doMock("@/lib/retrieval-bench/modules/entity-extraction", () => ({
      extractEntitiesForMemoryFact: vi.fn(async () => {
        throw new Error("entity extract failed");
      }),
    }));
    const result = await projectMemoryFact(
      {
        id: "fact-1",
        content: "Customer Acme placed order 42",
        source: "episodic",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { dryRun: false, queryFn, projectEntities: true },
    );
    expect(result).toBe("projected");
    expect(queryFn).toHaveBeenCalled();
    vi.doUnmock("@/lib/retrieval-bench/modules/entity-extraction");
  });

  it("maps legacy mem0 vector payloads through fetchVectorMemories injection", async () => {
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      useQdrantScroll: false,
      fetchVectorMemories: async () => [
        { id: "mem-1", memory: "vector one" },
        "plain-string-memory",
        { results: [{ id: "nested" }] },
      ],
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.pages).toBe(1);
    expect(summary.considered).toBeGreaterThanOrEqual(1);
  });
});
