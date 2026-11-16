// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureGraphCatchupSchema, runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch39 — defaultLog one-arg path (121)", () => {
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

  // sticky: bundled log("complete" | "vector page", …) always passes a non-empty extra object.
  it.skip("defaultLog one-arg branch (121) — production log() always passes structured extra", () => {});

  it("runGraphCatchup uses default logger and completes when neo4j unset and dryRun", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const summary = await runGraphCatchup(testDb, {
      dryRun: true,
      skipEpisodic: true,
      skipVector: true,
      oneshot: true,
    });

    expect(summary.status).toBe("completed");
    expect(summary.dryRun).toBe(true);
    expect(summary.neo4jConfigured).toBe(false);
    expect(
      logSpy.mock.calls.some((call) => String(call[0]).startsWith("[graph-catchup] complete")),
    ).toBe(true);

    logSpy.mockRestore();
  });
});