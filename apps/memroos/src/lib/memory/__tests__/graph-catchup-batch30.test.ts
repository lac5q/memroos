// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  isNeo4jConfigured,
  readGraphCatchupCheckpoint,
  runGraphCatchup,
} from "../graph-catchup";

describe("graph-catchup batch30 — neo4j config and checkpoint edges", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    vi.restoreAllMocks();
    delete process.env.NEO4J_PASSWORD;
  });

  it("isNeo4jConfigured is false for whitespace-only password", () => {
    expect(isNeo4jConfigured({ password: "   " })).toBe(false);
    expect(isNeo4jConfigured({ password: "neo4j-batch30" })).toBe(true);
  });

  it("readGraphCatchupCheckpoint returns zeroed cursor when row id is unknown", () => {
    const row = readGraphCatchupCheckpoint(testDb, `missing-${randomUUID()}`);
    expect(row.episodicLastId).toBe(0);
    expect(row.vectorLastId).toBeNull();
  });

  it("runGraphCatchup legacy mem0 path completes with default logger", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-batch30";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      fetchVectorMemories: async () => [
        {
          id: `mem-${randomUUID().slice(0, 8)}`,
          memory: "batch30 vector",
          created_at: "2026-11-07T10:00:00.000Z",
        },
      ],
      now: new Date("2026-11-07T12:00:00.000Z"),
    });
    expect(
      logSpy.mock.calls.some((call) => String(call[0]).includes("[graph-catchup] complete")),
    ).toBe(true);
    logSpy.mockRestore();
  });
});
