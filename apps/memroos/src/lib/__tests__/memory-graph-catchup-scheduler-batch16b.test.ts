// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { listCronHealthJobs } from "@/lib/cron-health";
import { readGraphCatchupCheckpoint } from "@/lib/memory/graph-catchup";

const testDb = new Database(":memory:");

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/graph-catchup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/graph-catchup")>();
  return {
    ...actual,
    runGraphCatchup: vi.fn(),
  };
});

initSchema(testDb);

describe("memory-graph-catchup-scheduler batch16b", () => {
  beforeEach(async () => {
    delete process.env.NEO4J_PASSWORD;
    const { GRAPH_CATCHUP_CRON_ID } = await import("@/lib/memory-graph-catchup-scheduler");
    testDb.prepare(`UPDATE cron_health_jobs SET status = 'active' WHERE id = ?`).run(GRAPH_CATCHUP_CRON_ID);
  });

  afterEach(async () => {
    const { stopGraphCatchupScheduler } = await import("@/lib/memory-graph-catchup-scheduler");
    stopGraphCatchupScheduler();
    vi.clearAllMocks();
  });

  it("exports 30 minute interval constant", async () => {
    const { GRAPH_CATCHUP_INTERVAL_MS } = await import("@/lib/memory-graph-catchup-scheduler");
    expect(GRAPH_CATCHUP_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it("runScheduledGraphCatchup records failed cron health when catchup fails", async () => {
    const graphCatchupModule = await import("@/lib/memory/graph-catchup");
    const scheduler = await import("@/lib/memory-graph-catchup-scheduler");
    const checkpoint = readGraphCatchupCheckpoint(testDb);
    vi.mocked(graphCatchupModule.runGraphCatchup).mockResolvedValueOnce({
      status: "failed",
      reason: "neo4j_unreachable",
      considered: 0,
      projected: 0,
      skipped: 0,
      errors: 1,
      dryRun: false,
      neo4jConfigured: true,
      checkpointBefore: checkpoint,
      checkpointAfter: checkpoint,
      sources: {
        episodic: { considered: 0, projected: 0, errors: 0 },
        vector: { considered: 0, projected: 0, errors: 0 },
      },
    });
    process.env.NEO4J_PASSWORD = "test-neo4j-pass";
    const summary = await scheduler.runScheduledGraphCatchup({
      now: new Date("2026-07-01T12:00:00.000Z"),
    });
    expect(summary.status).toBe("failed");
    const job = listCronHealthJobs(testDb).find((j) => j.id === scheduler.GRAPH_CATCHUP_CRON_ID);
    expect(job?.warning).toMatch(/neo4j_unreachable/);
  });

  it("startGraphCatchupScheduler is idempotent", async () => {
    const { startGraphCatchupScheduler } = await import("@/lib/memory-graph-catchup-scheduler");
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    startGraphCatchupScheduler();
    startGraphCatchupScheduler();
    expect(intervalSpy).toHaveBeenCalledTimes(1);
    intervalSpy.mockRestore();
  });
});
