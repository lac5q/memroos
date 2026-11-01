// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup, scrollQdrantPoints } from "../graph-catchup";

describe("graph-catchup batch20 — Qdrant scroll, default fetch, entity projection", () => {
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

  it("scrollQdrantPoints parses next_page_offset cursors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          result: {
            points: [{ id: "p1", payload: { memory: "vector one" } }],
            next_page_offset: "cursor-2",
          },
        }),
      ),
    );
    const page = await scrollQdrantPoints(null, 5, { url: "http://localhost:6333" });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("cursor-2");
  });

  it("projectMemoryFact skips entity MERGE when extraction yields no entities", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const outcome = await projectMemoryFact(
      {
        id: "fact-no-entities",
        content: "plain text without named entities",
        source: "batch20",
        agentId: "agent",
        createdAt: "2026-07-17T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(outcome).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("runGraphCatchup paginates vector pages when fetchVectorPage supplies a cursor", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    let pageCalls = 0;
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:40:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
      fetchVectorPage: async () => {
        pageCalls += 1;
        if (pageCalls === 1) {
          return {
            items: [{ id: "v1", memory: "first page memory", created_at: "2026-07-17T09:00:00.000Z" }],
            nextCursor: "page-2",
          };
        }
        return {
          items: [{ id: "v2", memory: "second page memory", created_at: "2026-07-17T09:01:00.000Z" }],
          nextCursor: null,
        };
      },
    });
    expect(pageCalls).toBe(2);
    expect(summary.pages).toBe(2);
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(2);
  });

  it("runGraphCatchup uses defaultSleep when writeDelayMs is set and sleep is omitted", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    vi.useFakeTimers();
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-delay', 'p1', 'agent', 'user', 'delay path content', '2026-07-17T10:05:00.000Z')`,
      )
      .run();
    const pending = runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      writeDelayMs: 25,
      now: new Date("2026-07-17T12:45:00.000Z"),
    });
    await vi.advanceTimersByTimeAsync(30);
    const summary = await pending;
    expect(summary.projected).toBeGreaterThanOrEqual(1);
  });
});
