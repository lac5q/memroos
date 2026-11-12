// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  GRAPH_CATCHUP_CHECKPOINT_ID,
  isNeo4jConfigured,
  mapVectorMemoryToProjection,
  normalizeVectorMemoryRaw,
  readGraphCatchupCheckpoint,
  runGraphCatchup,
  writeGraphCatchupCheckpoint,
} from "../graph-catchup";

describe("graph-catchup batch31 — defaultLog and projection branches", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    vi.restoreAllMocks();
  });

  it("isNeo4jConfigured is false when password is missing", () => {
    expect(isNeo4jConfigured({ password: "" })).toBe(false);
    expect(isNeo4jConfigured({})).toBe(false);
  });

  it("defaultLog prints structured vector page diagnostics (defaultLog branch coverage)", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-b31";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      fetchVectorPage: async () => ({
        items: [{ id: `v-b31-${randomUUID().slice(0, 6)}`, memory: "batch31 vector", created_at: "2026-03-01T09:00:00.000Z" }],
        nextCursor: null,
      }),
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(
      logSpy.mock.calls.some(
        (call) => String(call[0]).includes("[graph-catchup] vector page") && call[1] && typeof call[1] === "object",
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it("writeGraphCatchupCheckpoint round-trips cursor fields", () => {
    const updated = writeGraphCatchupCheckpoint(testDb, {
      id: GRAPH_CATCHUP_CHECKPOINT_ID,
      episodicLastId: 99,
      vectorLastCreatedAt: "2026-03-01T10:00:00.000Z",
      vectorLastId: `vec-b31-${randomUUID().slice(0, 6)}`,
    });
    expect(updated.episodicLastId).toBe(99);
    const reread = readGraphCatchupCheckpoint(testDb);
    expect(reread.vectorLastId).toBe(updated.vectorLastId);
  });

  it("normalizeVectorMemoryRaw and mapVectorMemoryToProjection accept qdrant payload wrappers", () => {
    const normalized = normalizeVectorMemoryRaw({
      id: "qdrant-b31",
      payload: { data: "vector payload b31", user_id: "agent-b31", created_at: "2026-03-01T09:00:00.000Z" },
    });
    expect(normalized?.data).toBe("vector payload b31");
    const projection = mapVectorMemoryToProjection(normalized);
    expect(projection?.source).toBe("vector");
    expect(projection?.agentId).toBe("agent-b31");
    expect(projection?.content).toContain("vector payload b31");
  });

  it("mapVectorMemoryToProjection returns null for empty memory text", () => {
    expect(mapVectorMemoryToProjection({ id: "empty-b31", memory: "  " })).toBeNull();
    expect(mapVectorMemoryToProjection(null)).toBeNull();
  });
});
