// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as graphCatchup from "@/lib/memory/graph-catchup";
import {
  runScheduledGraphCatchup,
  startGraphCatchupScheduler,
  stopGraphCatchupScheduler,
} from "@/lib/memory-graph-catchup-scheduler";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

beforeEach(() => {
  stopGraphCatchupScheduler();
  delete process.env.NEO4J_PASSWORD;
  vi.resetModules();
});

afterEach(() => {
  stopGraphCatchupScheduler();
  vi.restoreAllMocks();
});

describe("memory-graph-catchup-scheduler batch20c", () => {
  it("runScheduledGraphCatchup records skipped reason in cron warning metadata", async () => {
    process.env.NEO4J_PASSWORD = "configured";
    const checkpoint = graphCatchup.readGraphCatchupCheckpoint(testDb);
    vi.spyOn(graphCatchup, "runGraphCatchup").mockResolvedValue({
      status: "skipped",
      reason: "nothing_to_project",
      considered: 0,
      projected: 0,
      skipped: 0,
      errors: 0,
      dryRun: false,
      neo4jConfigured: true,
      checkpointBefore: checkpoint,
      checkpointAfter: checkpoint,
      sources: {
        episodic: { considered: 0, projected: 0, errors: 0 },
        vector: { considered: 0, projected: 0, errors: 0 },
      },
    });
    const summary = await runScheduledGraphCatchup({
      now: new Date("2026-08-03T00:00:00.000Z"),
    });
    expect(summary).toMatchObject({ status: "skipped", reason: "nothing_to_project" });
  });

  it("startGraphCatchupScheduler is idempotent and stop clears interval", () => {
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    startGraphCatchupScheduler();
    startGraphCatchupScheduler();
    expect(intervalSpy).toHaveBeenCalledTimes(1);
    stopGraphCatchupScheduler();
    expect(globalThis._graphCatchupInterval).toBeUndefined();
    intervalSpy.mockRestore();
  });
});
