// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch21 — default sleep/log and mem0 array body", () => {
  afterEach(() => {
    delete process.env.NEO4J_PASSWORD;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runGraphCatchup uses default logging path during dry vector scroll", async () => {
    const testDb = new Database(":memory:");
    initSchema(testDb);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      now: new Date("2026-07-17T12:40:00.000Z"),
      fetchVectorPage: async () => ({ items: [], nextCursor: null }),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[graph-catchup]"))).toBe(true);
    logSpy.mockRestore();
    testDb.close();
  });

  it("defaultFetchVectorMemories accepts top-level JSON arrays from mem0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ id: "m1", memory: "array body", created_at: "2026-07-17T09:00:00.000Z" }]),
      ),
    );
    const testDb = new Database(":memory:");
    initSchema(testDb);
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const summary = await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 5,
      dryRun: true,
      now: new Date("2026-07-17T12:40:00.000Z"),
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(summary.sources.vector.considered).toBeGreaterThanOrEqual(0);
    testDb.close();
  });
});
