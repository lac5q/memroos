// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("scheduler-singleton batch19", () => {
  let lockPath: string;

  afterEach(() => {
    vi.resetModules();
    if (lockPath && fs.existsSync(lockPath)) {
      try {
        fs.chmodSync(lockPath, 0o600);
        fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }
    delete process.env.MEMROOS_SCHEDULER_LOCK;
  });

  it("acquires lock when lockfile is unreadable and treated as stale", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b19-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));
    fs.chmodSync(lockPath, 0o000);
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    const acquired = tryAcquireSchedulerLock();
    fs.chmodSync(lockPath, 0o600);
    expect(acquired).toBe(true);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("returns false when exclusive create loses a race", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b19-race-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "424242");
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 424242) return true as unknown as void;
      return vi.mocked(process.kill).getOriginalImplementation()?.(pid, 0);
    });
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(false);
  });
});
