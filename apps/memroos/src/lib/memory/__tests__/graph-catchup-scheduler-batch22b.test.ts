// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = path.join(os.tmpdir(), `graph-sched-b22b-${crypto.randomUUID()}`);

describe("memory-graph-catchup-scheduler batch22b", () => {
  beforeEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    process.env.SQLITE_DB_PATH = path.join(TMP, "sched.db");
    globalThis._graphCatchupInterval = undefined;
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("@/lib/memory/graph-catchup");
    vi.resetModules();
    const sched = await import("@/lib/memory-graph-catchup-scheduler");
    sched.stopGraphCatchupScheduler();
    const dbMod = await import("@/lib/db");
    dbMod.closeDb();
    delete process.env.SQLITE_DB_PATH;
    vi.restoreAllMocks();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("runScheduledGraphCatchup records partial warnings in cron health", async () => {
    vi.doMock("@/lib/memory/graph-catchup", async () => {
      const actual = await vi.importActual<typeof import("@/lib/memory/graph-catchup")>("@/lib/memory/graph-catchup");
      return {
        ...actual,
        isNeo4jConfigured: () => true,
        runGraphCatchup: vi.fn().mockResolvedValue({
          status: "partial",
          reason: null,
          considered: 2,
          projected: 1,
          skipped: 0,
          errors: 1,
          dryRun: false,
          checkpointAfter: { episodicLastId: "e1", vectorLastId: "v1" },
        }),
      };
    });
    const { runScheduledGraphCatchup } = await import("@/lib/memory-graph-catchup-scheduler");
    const summary = await runScheduledGraphCatchup({ dryRun: true });
    expect(summary).toMatchObject({ status: "partial", errors: 1 });
  });

  it("runScheduledGraphCatchup skips when cron job is paused", async () => {
    const { runScheduledGraphCatchup, GRAPH_CATCHUP_CRON_ID } = await import("@/lib/memory-graph-catchup-scheduler");
    const cronHealth = await import("@/lib/cron-health");
    const { getDb } = await import("@/lib/db");
    cronHealth.ensureDefaultCronJobs(getDb());
    cronHealth.updateCronJobStatus(getDb(), GRAPH_CATCHUP_CRON_ID, "paused");
    const summary = await runScheduledGraphCatchup({ dryRun: true });
    expect(summary).toEqual({ status: "skipped", reason: "cron_paused_or_stopped" });
  });
});
