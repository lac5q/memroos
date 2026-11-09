// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("scheduler-singleton batch30b", () => {
  let lockPath: string;

  afterEach(() => {
    vi.resetModules();
    if (lockPath && fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
    delete process.env.MEMROOS_SCHEDULER_LOCK;
  });

  it("releases lockfile on process exit handler", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b30b-")), "scheduler.lock");
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);
    process.emit("exit", 0);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("returns false when lock create races and EEXIST is thrown", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b30b-race-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "999999");
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 999999) return true as unknown as void;
      return vi.mocked(process.kill).getOriginalImplementation()?.(pid, 0);
    });
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(false);
  });
});
