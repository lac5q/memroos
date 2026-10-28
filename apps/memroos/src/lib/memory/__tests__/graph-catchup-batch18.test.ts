// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { projectMemoryFact, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch18 — episodic skips and entity projection errors", () => {
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

  it("projectMemoryFact logs and continues when entity projection fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("entity-merge-failed"));
    const mode = await projectMemoryFact(
      {
        id: "fact-entities",
        content: "MemRoOS shipped with Acme Corporation integration.",
        source: "test",
      },
      { queryFn, projectEntities: true },
    );
    expect(mode).toBe("projected");
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("entity projection failed"))).toBe(
      true,
    );
    warnSpy.mockRestore();
  });

  it("runGraphCatchup skips episodic rows with blank content but advances cursor", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('s-blank', 'p1', 'luis', 'user', '   ', '2026-07-17T10:01:00.000Z')`,
      )
      .run();
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:00:00.000Z"),
      projectFact: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.sources.episodic.considered).toBe(0);
  });

  it("runGraphCatchup captures episodic projection errors in errorSamples", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    testDb
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES ('s-fail', 'p1', 'luis', 'user', ?, '2026-07-17T10:02:00.000Z')`,
      )
      .run("Episodic row that should fail projection.");
    const summary = await runGraphCatchup(testDb, {
      skipVector: true,
      oneshot: true,
      batchSize: 5,
      now: new Date("2026-07-17T12:05:00.000Z"),
      projectFact: async () => {
        throw new Error("episodic-project-boom");
      },
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.errors).toBeGreaterThanOrEqual(1);
    expect(summary.errorSamples?.some((sample) => sample.includes("episodic-project-boom"))).toBe(true);
  });
});
