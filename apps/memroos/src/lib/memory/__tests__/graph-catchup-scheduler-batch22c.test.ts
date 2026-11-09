// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = path.join(os.tmpdir(), `graph-sched-b22c-${crypto.randomUUID()}`);

describe("memory-graph-catchup-scheduler batch22c", () => {
  beforeEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    process.env.SQLITE_DB_PATH = path.join(TMP, "sched.db");
    globalThis._graphCatchupInterval = undefined;
    vi.resetModules();
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  it("startGraphCatchupScheduler runs initial tick and interval callbacks", async () => {
    const runMock = vi.fn().mockResolvedValue({
      status: "skipped",
      reason: "batch22c",
      considered: 0,
      projected: 0,
      skipped: 0,
      errors: 0,
      dryRun: false,
      checkpointAfter: { episodicLastId: null, vectorLastId: null },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    vi.doMock("@/lib/memory/graph-catchup", async () => {
      const actual = await vi.importActual<typeof import("@/lib/memory/graph-catchup")>("@/lib/memory/graph-catchup");
      return {
        ...actual,
        isNeo4jConfigured: () => true,
        runGraphCatchup: runMock,
      };
    });

    const { startGraphCatchupScheduler, stopGraphCatchupScheduler, GRAPH_CATCHUP_INTERVAL_MS } = await import(
      "@/lib/memory-graph-catchup-scheduler"
    );

    vi.useFakeTimers();
    startGraphCatchupScheduler();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("scheduler started"));
    await vi.advanceTimersByTimeAsync(0);
    expect(runMock).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GRAPH_CATCHUP_INTERVAL_MS);
    expect(runMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    stopGraphCatchupScheduler();
    logSpy.mockRestore();
    errSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
