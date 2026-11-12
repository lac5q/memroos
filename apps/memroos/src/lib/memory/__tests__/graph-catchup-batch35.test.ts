// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  countNeo4jNodes,
  projectMemoryFact,
  runGraphCatchup,
  scrollQdrantPoints,
} from "../graph-catchup";

let testDb: Database.Database | null = null;

beforeEach(() => {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
});

afterEach(() => {
  testDb?.close();
  testDb = null;
  delete process.env.NEO4J_PASSWORD;
  delete process.env.QDRANT_URL;
  vi.restoreAllMocks();
});

describe("graph-catchup batch35 — branch gaps", () => {
  it.skip("defaultLog one-arg branch (121) — production log() always passes structured extra", () => {});

  it("runGraphCatchup returns skipped when Neo4j is not configured (554-557)", async () => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    delete process.env.NEO4J_PASSWORD;
    const summary = await runGraphCatchup(testDb, { dryRun: false, skipEpisodic: true, skipVector: true });
    expect(summary.status).toBe("skipped");
    expect(summary.reason).toBe("neo4j_not_configured");
  });

  it("scrollQdrantPoints rejects missing QDRANT_URL (445)", async () => {
    delete process.env.QDRANT_URL;
    let caught: unknown;
    try {
      await scrollQdrantPoints(null, 5, { url: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("QDRANT_URL is not configured");
  });

  it("scrollQdrantPoints surfaces HTTP failures (473-474)", async () => {
    const prevFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as typeof fetch;
    let caught: unknown;
    try {
      await scrollQdrantPoints(null, 3, { url: "http://localhost:6333", collection: "agent_memory_local" });
    } catch (error) {
      caught = error;
    } finally {
      global.fetch = prevFetch;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Qdrant scroll failed: HTTP 503");
  });

  it("countNeo4jNodes coerces string counts from Neo4j (342)", async () => {
    const queryFn = vi.fn(async () => ({
      results: [{ data: [{ row: ["42"] }] }],
      errors: [] as unknown[],
    }));
    await expect(countNeo4jNodes(queryFn)).resolves.toBe(42);
  });

  it("projectMemoryFact skips entity projection when disabled (405-407)", async () => {
    const queryFn = vi.fn(async () => ({ results: [{ data: [{ row: ["ok"] }] }], errors: [] as unknown[] }));
    const result = await projectMemoryFact(
      {
        id: `vector:b35-${randomUUID().slice(0, 6)}`,
        content: "Acme Corp mentions MemRoOS graph catchup batch35",
        source: "vector",
        agentId: "agent-b35",
        createdAt: "2026-03-05T10:00:00.000Z",
      },
      { queryFn, projectEntities: false },
    );
    expect(result).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("runGraphCatchup legacy mem0 vector path maps items when Qdrant scroll is off (690-712)", async () => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    process.env.NEO4J_PASSWORD = "neo4j-b35";
    delete process.env.QDRANT_URL;

    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      fetchVectorMemories: async () => [
        { id: `legacy-b35-${randomUUID().slice(0, 6)}`, memory: "legacy vector batch35", created_at: "2026-03-05T11:00:00.000Z" },
      ],
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(1);
    expect(summary.sources.vector.projected).toBeGreaterThanOrEqual(1);
  });
});
