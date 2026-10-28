// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch19b — episodic empty content and skip flags", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("skips episodic rows with empty content without failing the sweep", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('sess-empty', 'p1', 'agent', 'user', ?, '2026-07-17T10:00:00.000Z')`,
      )
      .run("   ");
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:30:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.projected).toBe(0);
  });

  it("honors skipVector and skipEpisodic together for a no-op dry run", async () => {
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      skipEpisodic: true,
      oneshot: true,
      dryRun: true,
      now: new Date("2026-07-17T12:31:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.considered).toBe(0);
    expect(summary.status).toBe("completed");
  });
});
