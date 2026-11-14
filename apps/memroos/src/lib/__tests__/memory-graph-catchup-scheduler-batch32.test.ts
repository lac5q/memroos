// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = path.join(os.tmpdir(), `graph-sched-b32-${crypto.randomUUID()}`);

describe("memory-graph-catchup-scheduler batch32 — tick error logging", () => {
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

  it("logs initial and interval tick failures (106, 111)", async () => {
    const runMock = vi.fn().mockRejectedValue(new Error("batch32 graph tick fail"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

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
    await vi.advanceTimersByTimeAsync(0);
    expect(errSpy).toHaveBeenCalledWith("[graph-catchup] initial tick failed", expect.any(Error));

    await vi.advanceTimersByTimeAsync(GRAPH_CATCHUP_INTERVAL_MS);
    expect(errSpy.mock.calls.some((c) => c[0] === "[graph-catchup] tick failed")).toBe(true);

    stopGraphCatchupScheduler();
  });
});
