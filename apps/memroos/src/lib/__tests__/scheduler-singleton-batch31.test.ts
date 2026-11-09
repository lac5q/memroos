// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

describe("scheduler-singleton batch31", () => {
  let lockPath: string;

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    if (lockPath && fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
    delete process.env.MEMROOS_SCHEDULER_LOCK;
  });

  it("returns false when lock create throws inside try/catch (line 53)", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    lockPath = path.join(os.tmpdir(), `sched-b31-${randomUUID().slice(0, 8)}`, "scheduler.lock");
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      ...actualFs,
      existsSync: actualFs.existsSync,
      mkdirSync: actualFs.mkdirSync,
      readFileSync: actualFs.readFileSync,
      writeFileSync: actualFs.writeFileSync,
      closeSync: actualFs.closeSync,
      unlinkSync: actualFs.unlinkSync,
      openSync: () => {
        throw new Error("EEXIST batch31");
      },
    }));
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(false);
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("releases lock on SIGINT and SIGTERM handlers (lines 63–64)", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b31-sig-")), "scheduler.lock");
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    const handlers: Record<string, () => void> = {};
    const onSpy = vi.spyOn(process, "on").mockImplementation((event, handler) => {
      if (typeof handler === "function") handlers[String(event)] = handler;
      return process;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);

    handlers.SIGINT?.();
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(0);

    tryAcquireSchedulerLock();
    handlers.SIGTERM?.();
    expect(fs.existsSync(lockPath)).toBe(false);

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
