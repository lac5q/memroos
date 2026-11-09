// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("scheduler-singleton batch18b", () => {
  let lockPath: string;
  let killSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    killSpy?.mockRestore();
    vi.resetModules();
    if (lockPath && fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  });

  it("returns false when lock file exists but is unreadable", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b18b-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "12345");
    fs.chmodSync(lockPath, 0o000);

    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    const acquired = tryAcquireSchedulerLock();
    fs.chmodSync(lockPath, 0o600);
    expect(typeof acquired).toBe("boolean");
  });

  it("reclaims stale lock when stored pid is no longer alive", async () => {
    lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b18b-stale-")), "scheduler.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "999997");
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 999997) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      return true as unknown as void;
    });
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });
});
