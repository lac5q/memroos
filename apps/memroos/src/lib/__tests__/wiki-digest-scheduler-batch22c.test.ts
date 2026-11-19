// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = path.join(os.tmpdir(), `wiki-sched-b22c-${crypto.randomUUID()}`);

describe("wiki-digest-scheduler batch22c", () => {
  beforeEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    process.env.SQLITE_DB_PATH = path.join(TMP, "wiki-sched.db");
    globalThis._wikiDigestInterval = undefined;
    vi.resetModules();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    const sched = await import("@/lib/wiki-digest-scheduler");
    sched.stopWikiDigestScheduler();
    const dbMod = await import("@/lib/db");
    dbMod.closeDb();
    delete process.env.SQLITE_DB_PATH;
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("startWikiDigestScheduler schedules interval and deferred first tick", async () => {
    const runMock = vi.fn().mockRejectedValue(new Error("wiki digest batch22c failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.doMock("@/lib/wiki-digest", async () => {
      const actual = await vi.importActual<typeof import("@/lib/wiki-digest")>("@/lib/wiki-digest");
      return {
        ...actual,
        runWikiDigest: runMock,
      };
    });

    const { startWikiDigestScheduler, stopWikiDigestScheduler, WIKI_DIGEST_INTERVAL_MS } = await import(
      "@/lib/wiki-digest-scheduler"
    );

    vi.useFakeTimers();
    startWikiDigestScheduler();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(runMock).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith("[wiki-digest] scheduled run failed", "wiki digest batch22c failed");

    await vi.advanceTimersByTimeAsync(WIKI_DIGEST_INTERVAL_MS);
    expect(runMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    stopWikiDigestScheduler();
    errSpy.mockRestore();
  });
});
