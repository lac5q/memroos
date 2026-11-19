// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { listCronHealthJobs } from "@/lib/cron-health";

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

describe("memory-graph-catchup-scheduler batch18 — cron warnings and failures", () => {
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

  it("records partial warnings when catchup completes with errors", async () => {
    const graphCatchupModule = await import("@/lib/memory/graph-catchup");
    const scheduler = await import("@/lib/memory-graph-catchup-scheduler");
    const checkpoint = graphCatchupModule.readGraphCatchupCheckpoint(testDb);
    vi.mocked(graphCatchupModule.runGraphCatchup).mockResolvedValueOnce({
      status: "partial",
      reason: "neo4j_partial",
      considered: 2,
      projected: 1,
      skipped: 0,
      errors: 1,
      dryRun: false,
      neo4jConfigured: true,
      checkpointBefore: checkpoint,
      checkpointAfter: checkpoint,
      sources: {
        episodic: { considered: 1, projected: 1, errors: 0 },
        vector: { considered: 1, projected: 0, errors: 1 },
      },
    });
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    const summary = await scheduler.runScheduledGraphCatchup({
      now: new Date("2026-07-01T12:00:00.000Z"),
    });
    expect(summary.status).toBe("partial");
    const job = listCronHealthJobs(testDb).find((j) => j.id === scheduler.GRAPH_CATCHUP_CRON_ID);
    expect(job?.warning).toMatch(/graph_catchup_partial_errors:1/);
  });

  it("propagates runGraphCatchup failures into cron health warnings", async () => {
    const graphCatchupModule = await import("@/lib/memory/graph-catchup");
    const scheduler = await import("@/lib/memory-graph-catchup-scheduler");
    vi.mocked(graphCatchupModule.runGraphCatchup).mockImplementationOnce(() =>
      Promise.reject(new Error("boom-scheduler")),
    );
    process.env.NEO4J_PASSWORD = "neo4j-pass";
    await scheduler
      .runScheduledGraphCatchup({ now: new Date("2026-07-01T12:30:00.000Z") })
      .catch((err: unknown) => {
        expect(err instanceof Error ? err.message : String(err)).toMatch(/boom-scheduler/);
      });
    const job = listCronHealthJobs(testDb).find((j) => j.id === scheduler.GRAPH_CATCHUP_CRON_ID);
    expect(job?.warning).toMatch(/graph_catchup_error:boom-scheduler/);
  });

  it("startGraphCatchupScheduler logs idle message when Neo4j is not configured", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    const { startGraphCatchupScheduler, stopGraphCatchupScheduler } = await import(
      "@/lib/memory-graph-catchup-scheduler"
    );
    startGraphCatchupScheduler();
    expect(infoSpy.mock.calls.some((call) => String(call[0]).includes("Neo4j not configured"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("scheduler started"))).toBe(true);
    stopGraphCatchupScheduler();
    intervalSpy.mockRestore();
    infoSpy.mockRestore();
    logSpy.mockRestore();
  });
});
