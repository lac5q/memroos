// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  isAfterVectorCursor,
  mapEpisodicMessageToProjection,
  mapVectorMemoryToProjection,
  normalizeVectorMemoryPoint,
  projectMemoryFact,
  projectMemoryToGraph,
  readGraphCatchupCheckpoint,
  runGraphCatchup,
  scrollQdrantPoints,
  writeGraphCatchupCheckpoint,
} from "../graph-catchup";

describe("graph-catchup batch34 — cursor, projection, and run branches", () => {
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
  });

  // sticky: defaultLog one-argument branch (line 121) — bundled log() calls always pass structured extra.

  it("readGraphCatchupCheckpoint coerces null vector cursor fields (178-181)", () => {
    testDb.exec(`
      INSERT INTO graph_catchup_checkpoints (id, episodic_last_id, vector_last_created_at, vector_last_id, updated_at)
      VALUES ('custom-b34', 5, NULL, NULL, '2026-03-01T00:00:00.000Z')
    `);
    const row = readGraphCatchupCheckpoint(testDb, "custom-b34");
    expect(row.episodicLastId).toBe(5);
    expect(row.vectorLastCreatedAt).toBeNull();
    expect(row.vectorLastId).toBeNull();
  });

  it("mapEpisodicMessageToProjection tolerates null agent and timestamp (219, 222)", () => {
    const item = mapEpisodicMessageToProjection({
      id: 42,
      content: "batch34 episodic",
      agent_id: null,
      timestamp: null,
    });
    expect(item.agentId).toBeNull();
    expect(item.createdAt).toBeNull();
    expect(item.content).toContain("batch34");
  });

  it("mapVectorMemoryToProjection resolves content, text, ingested_at, and metadata agent (252-292)", () => {
    expect(
      mapVectorMemoryToProjection({ id: "t1", text: "  text branch b34  ", ingested_at: "2026-03-01T09:00:00.000Z" }),
    ).toMatchObject({ source: "vector", content: expect.stringContaining("text branch") });
    expect(
      mapVectorMemoryToProjection(
        { memory_id: 99, content: "content branch", metadata: { saved_by_agent: "agent-b34" } },
        3,
      ),
    ).toMatchObject({ agentId: "agent-b34", id: "vector:99" });
    expect(mapVectorMemoryToProjection({ data: "data only" }, 7)?.id).toBe("vector:vector-anon-7");
  });

  it("isAfterVectorCursor compares createdAt and id tie-breakers (315-323)", () => {
    const cursor = { vectorLastCreatedAt: "2026-03-01T10:00:00.000Z", vectorLastId: "aaa" };
    expect(isAfterVectorCursor({ id: "vector:bbb", createdAt: "2026-03-01T11:00:00.000Z" }, cursor)).toBe(true);
    expect(isAfterVectorCursor({ id: "vector:bbb", createdAt: "2026-03-01T09:00:00.000Z" }, cursor)).toBe(false);
    expect(isAfterVectorCursor({ id: "vector:bbb", createdAt: "2026-03-01T10:00:00.000Z" }, cursor)).toBe(true);
    expect(isAfterVectorCursor({ id: "bbb", createdAt: null }, { vectorLastCreatedAt: null, vectorLastId: "aaa" })).toBe(
      true,
    );
    expect(isAfterVectorCursor({ id: "aaa", createdAt: "2026-03-01T10:00:00.000Z" }, cursor)).toBe(false);
  });

  it("projectMemoryFact warns and continues when entity projection fails (413)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ results: [{ data: [{ row: ["ok"] }] }] })
      .mockRejectedValueOnce(new Error("entity_merge_failed_b34"));
    await projectMemoryFact(
      {
        id: "vector:b34-entity",
        content: "MemRoOS graph catchup batch34 exercises Acme Corp entity extraction",
        source: "vector",
        agentId: "codex",
        createdAt: "2026-03-01T10:00:00.000Z",
      },
      { queryFn, projectEntities: true },
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("scrollQdrantPoints parses scroll payload with next offset (476-481)", async () => {
    const prevFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { points: [{ id: "p1", payload: { data: "qdrant b34" } }], next_page_offset: "cursor-b34" },
      }),
    }) as typeof fetch;
    try {
      const page = await scrollQdrantPoints(null, 5, { url: "http://localhost:6333", collection: "agent_memory_local" });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBe("cursor-b34");
    } finally {
      global.fetch = prevFetch;
    }
  });

  it("runGraphCatchup skips empty episodic rows and records vector incremental skips", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-b34";
    writeGraphCatchupCheckpoint(testDb, {
      id: "default",
      episodicLastId: 0,
      vectorLastCreatedAt: "2026-03-01T12:00:00.000Z",
      vectorLastId: "zzz",
    });
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES (?, 'alpha', 'agent', 'user', '   ', datetime('now')),
                (?, 'alpha', 'agent', 'user', 'batch34 episodic body', datetime('now'))`,
      )
      .run(`sess-${randomUUID()}`, `sess-${randomUUID()}`);

    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      dryRun: true,
      oneshot: true,
      batchSize: 10,
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.sources.episodic.considered).toBeGreaterThanOrEqual(1);
  });

  it("runGraphCatchup paged vector path honors maxPoints during scroll (630-646, 708-710)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-b34";
    let pageCalls = 0;
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      maxPoints: 1,
      pageSize: 5,
      fetchVectorPage: async () => {
        pageCalls += 1;
        return {
          items: [
            { id: `v1-b34-${randomUUID().slice(0, 6)}`, memory: "first page", created_at: "2026-03-01T10:00:00.000Z" },
            { id: `v2-b34-${randomUUID().slice(0, 6)}`, memory: "second page", created_at: "2026-03-01T10:01:00.000Z" },
          ],
          nextCursor: pageCalls < 2 ? "cursor-b34" : null,
        };
      },
    });
    expect(summary.considered).toBe(1);
    expect(summary.projected).toBe(1);
  });

  it("normalizeVectorMemoryPoint and projectMemoryToGraph cover hash and empty arms (831-847)", () => {
    const point = normalizeVectorMemoryPoint({
      id: "nv-b34",
      memory: "normalize point",
      hash: "sha256-b34",
      user_id: "agent-b34",
    });
    expect(point?.hash).toBe("sha256-b34");
    expect(projectMemoryToGraph({ id: "empty", content: "  " }).skipped).toBe(true);
    const preview = projectMemoryToGraph({
      id: "fact-b34",
      content: "Batch34 preview mentions MemRoOS operator console",
      userId: "agent-b34",
    });
    expect(preview.skipped).toBe(false);
    expect(preview.fact?.source).toBe("agent-b34");
  });
});
