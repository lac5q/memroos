// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureGraphCatchupSchema,
  isAfterVectorCursor,
  isNeo4jConfigured,
  mapVectorMemoryToProjection,
  normalizeVectorMemoryRaw,
  projectMemoryFact,
  readGraphCatchupCheckpoint,
  runGraphCatchup,
} from "../graph-catchup";

describe("graph-catchup batch39d — branch coverage", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    ensureGraphCatchupSchema(testDb);
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
  });

  afterEach(() => {
    testDb.close();
    vi.restoreAllMocks();
    delete process.env.NEO4J_PASSWORD;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
  });

  it.skip("defaultLog one-argument branch (121) — production log() always passes structured extra", () => {});

  it("readGraphCatchupCheckpoint returns defaults when checkpoint row missing", () => {
    const cp = readGraphCatchupCheckpoint(testDb, `missing-b39d-${randomUUID().slice(0, 8)}`);
    expect(cp.episodicLastId).toBe(0);
    expect(cp.vectorLastCreatedAt).toBeNull();
  });

  it("isNeo4jConfigured is false without password", () => {
    expect(isNeo4jConfigured({ password: "" })).toBe(false);
    expect(isNeo4jConfigured({ password: "   " })).toBe(false);
  });

  it("normalizeVectorMemoryRaw unwraps Qdrant payload rows", () => {
    const row = normalizeVectorMemoryRaw({
      id: "pt-b39d",
      payload: { memory: "vector payload batch39d", user_id: "agent-b39d" },
    });
    expect(row?.memory).toBe("vector payload batch39d");
  });

  it("mapVectorMemoryToProjection returns null for empty content", () => {
    expect(mapVectorMemoryToProjection({ memory: "   " })).toBeNull();
    expect(mapVectorMemoryToProjection(null)).toBeNull();
  });

  it("isAfterVectorCursor orders lexicographic ids after timestamp tie", () => {
    expect(
      isAfterVectorCursor(
        { id: "vector:bbb-b39d", createdAt: "2026-01-02T00:00:00.000Z" },
        { vectorLastCreatedAt: "2026-01-02T00:00:00.000Z", vectorLastId: "aaa-b39d" },
      ),
    ).toBe(true);
    expect(
      isAfterVectorCursor(
        { id: "vector:aaa-b39d", createdAt: "2026-01-02T00:00:00.000Z" },
        { vectorLastCreatedAt: "2026-01-02T00:00:00.000Z", vectorLastId: "bbb-b39d" },
      ),
    ).toBe(false);
  });

  it("projectMemoryFact returns dry_run without neo4j writes", async () => {
    const queryFn = vi.fn(async () => ({ results: [], errors: [] as unknown[] }));
    const result = await projectMemoryFact(
      {
        id: `dry-b39d-${randomUUID().slice(0, 6)}`,
        content: "Acme discusses graph catchup batch39d",
        source: "episodic",
      },
      { dryRun: true, queryFn },
    );
    expect(result).toBe("dry_run");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("runGraphCatchup completes episodic-only dry run with custom logger branches", async () => {
    const messages: string[] = [];
    const summary = await runGraphCatchup(testDb, {
      dryRun: true,
      skipVector: true,
      oneshot: true,
      log: (message, extra) => {
        messages.push(extra ? `${message}:extra` : message);
      },
    });
    expect(summary.status).toBe("completed");
    expect(messages.some((m) => m.includes("complete"))).toBe(true);
  });
});