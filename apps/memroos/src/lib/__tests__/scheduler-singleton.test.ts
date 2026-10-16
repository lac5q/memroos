// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("tryAcquireSchedulerLock", () => {
  let lockPath: string;
  let killSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    killSpy?.mockRestore();
    vi.resetModules();
    if (lockPath && fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  });

  async function loadLockModule() {
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    return import("@/lib/scheduler-singleton");
  }

  it("acquires lock when none exists", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-lock-")), "scheduler.lock");
    const { tryAcquireSchedulerLock } = await loadLockModule();
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("returns false when another live pid holds the lock", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-lock-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "999999");

    killSpy = vi.spyOn(process, "kill").mockImplementation((pid: number) => {
      if (pid === 999999) return true as unknown as void;
      return true as unknown as void;
    });

    const { tryAcquireSchedulerLock } = await loadLockModule();
    expect(tryAcquireSchedulerLock()).toBe(false);
  });

  it("reclaims stale lock when pid is dead", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-lock-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "999998");

    killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 999998) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      return true as unknown as void;
    });

    const { tryAcquireSchedulerLock } = await loadLockModule();
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });
});
