// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { listCronHealthJobs, updateCronJobStatus } from "@/lib/cron-health";
import {
  RETENTION_EXPIRY_CRON_ID,
  runScheduledRetentionExpiry,
  startRetentionExpiryScheduler,
  stopRetentionExpiryScheduler,
} from "@/lib/memory-retention-expiry-scheduler";

const testDb = new Database(":memory:");

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

initSchema(testDb);

afterEach(() => {
  stopRetentionExpiryScheduler();
  testDb.exec("DELETE FROM cron_health_jobs");
});

describe("memory-retention-expiry-scheduler batch23b", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM cron_health_jobs");
  });

  it("skips scheduled run when cron job is paused", () => {
    listCronHealthJobs(testDb);
    updateCronJobStatus(testDb, RETENTION_EXPIRY_CRON_ID, "paused");

    const result = runScheduledRetentionExpiry({ now: new Date("2026-10-30T09:00:00.000Z") });
    expect(result).toEqual({ status: "skipped", reason: "cron_paused_or_stopped" });
  });

  it("startRetentionExpiryScheduler is idempotent", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    startRetentionExpiryScheduler();
    const first = globalThis._retentionExpiryInterval;
    startRetentionExpiryScheduler();
    expect(globalThis._retentionExpiryInterval).toBe(first);
    stopRetentionExpiryScheduler();
    logSpy.mockRestore();
  });
});
