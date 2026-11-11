// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db-schema";
import {
  ensureDefaultCronJobs,
  isCronJobRunnable,
  listCronHealthJobs,
  recordCronHealthRun,
  updateCronJobStatus,
  upsertCronHealthJob,
  type CronHealthJobInput,
} from "@/lib/cron-health";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

const sampleJob: CronHealthJobInput = {
  id: "test-job",
  name: "Test job",
  sourceFamily: "memory",
  schedule: "every 5 minutes",
  expectedIntervalMinutes: 5,
};

describe("ensureDefaultCronJobs", () => {
  it("seeds all 8 default cron jobs when table is empty", () => {
    const db = freshDb();
    ensureDefaultCronJobs(db);
    const jobs = listCronHealthJobs(db);
    expect(jobs).toHaveLength(8);
    const ids = jobs.map((j) => j.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "memory-consolidation",
        "memory-decay",
        "memory-retention-expiry",
        "hil-sla",
        "embeddings",
        "graph-catchup",
        "wiki-digest",
        "apo-skill-improvement",
      ]),
    );
  });

  it("does not overwrite pause/stop state on existing rows", () => {
    const db = freshDb();
    ensureDefaultCronJobs(db);
    updateCronJobStatus(db, "memory-consolidation", "paused");
    const before = listCronHealthJobs(db).find((j) => j.id === "memory-consolidation");
    const beforeUpdatedAt = before?.updatedAt;
    ensureDefaultCronJobs(db);
    const after = listCronHealthJobs(db).find((j) => j.id === "memory-consolidation");
    expect(after?.status).toBe("paused");
    expect(after?.updatedAt).toBe(beforeUpdatedAt);
  });

  it("seeds only missing jobs, leaving existing ones untouched", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, id: "custom-job", name: "Custom" });
    ensureDefaultCronJobs(db);
    const jobs = listCronHealthJobs(db);
    expect(jobs).toHaveLength(9);
    expect(jobs.find((j) => j.id === "custom-job")).toBeDefined();
    expect(jobs.find((j) => j.id === "memory-consolidation")).toBeDefined();
  });

  it("is idempotent — running twice does not duplicate rows", () => {
    const db = freshDb();
    ensureDefaultCronJobs(db);
    ensureDefaultCronJobs(db);
    expect(listCronHealthJobs(db)).toHaveLength(8);
  });
});

describe("upsertCronHealthJob", () => {
  it("inserts a new job with defaults applied", () => {
    const db = freshDb();
    const job = upsertCronHealthJob(db, sampleJob);
    expect(job.id).toBe("test-job");
    expect(job.status).toBe("active");
    expect(job.owner).toBe("memroos");
    expect(job.healthEndpoint).toBeNull();
    expect(job.expectedIntervalMinutes).toBe(5);
    expect(job.itemsProcessed).toBe(0);
    expect(job.lastRunAt).toBeNull();
    expect(job.metadata).toEqual({});
  });

  it("normalizes invalid status to active", () => {
    const db = freshDb();
    const job = upsertCronHealthJob(db, {
      ...sampleJob,
      status: "garbage" as unknown as "active",
    });
    expect(job.status).toBe("active");
  });

  it("preserves paused and stopped statuses", () => {
    const db = freshDb();
    expect(upsertCronHealthJob(db, { ...sampleJob, status: "paused" }).status).toBe("paused");
    expect(upsertCronHealthJob(db, { ...sampleJob, status: "stopped" }).status).toBe("stopped");
  });

  it("captures optional healthEndpoint, owner, metadata", () => {
    const db = freshDb();
    const job = upsertCronHealthJob(db, {
      ...sampleJob,
      healthEndpoint: "/api/health",
      owner: "ops",
      metadata: { team: "platform" },
    });
    expect(job.healthEndpoint).toBe("/api/health");
    expect(job.owner).toBe("ops");
    expect(job.metadata).toEqual({ team: "platform" });
  });

  it("updates existing row (ON CONFLICT)", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, itemsProcessed: 5 });
    const updated = upsertCronHealthJob(db, { ...sampleJob, itemsProcessed: 12 });
    expect(updated.itemsProcessed).toBe(12);
  });

});

describe("updateCronJobStatus", () => {
  it("updates status and returns the updated job", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    const updated = updateCronJobStatus(db, "test-job", "paused");
    expect(updated?.status).toBe("paused");
  });

  it("returns null when the job does not exist", () => {
    const db = freshDb();
    expect(updateCronJobStatus(db, "no-such-job", "paused")).toBeNull();
  });

  it("rejects invalid status via SQLite CHECK constraint", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    expect(() =>
      updateCronJobStatus(db, "test-job", "bogus" as unknown as "paused"),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe("isCronJobRunnable", () => {
  it("returns true for an active job", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    expect(isCronJobRunnable(db, "test-job")).toBe(true);
  });

  it("returns false for a paused job", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, status: "paused" });
    expect(isCronJobRunnable(db, "test-job")).toBe(false);
  });

  it("returns false for a stopped job", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, status: "stopped" });
    expect(isCronJobRunnable(db, "test-job")).toBe(false);
  });

  it("returns false for a non-existent job (after seeding defaults)", () => {
    const db = freshDb();
    expect(isCronJobRunnable(db, "nope")).toBe(false);
  });

  it("seeds default jobs before checking", () => {
    const db = freshDb();
    expect(isCronJobRunnable(db, "memory-consolidation")).toBe(true);
  });
});

describe("recordCronHealthRun", () => {
  it("records lastRunAt and lastSuccessAt on success", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    const now = new Date();
    const job = recordCronHealthRun(db, "test-job", { success: true, itemsProcessed: 7, now });
    expect(job?.lastRunAt).toBe(now.toISOString());
    expect(job?.lastSuccessAt).toBe(now.toISOString());
    expect(job?.lastFailureAt).toBeNull();
    expect(job?.itemsProcessed).toBe(7);
  });

  it("records lastRunAt and lastFailureAt on failure (does not touch lastSuccessAt)", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    recordCronHealthRun(db, "test-job", { success: true });
    const afterSuccess = listCronHealthJobs(db).find((j) => j.id === "test-job");
    const laterTime = new Date(Date.now() + 1000);
    const failure = recordCronHealthRun(db, "test-job", { success: false, warning: "boom", now: laterTime });
    expect(failure?.lastRunAt).toBe(laterTime.toISOString());
    expect(failure?.lastSuccessAt).toBe(afterSuccess?.lastSuccessAt);
    expect(failure?.lastFailureAt).toBe(laterTime.toISOString());
    expect(failure?.warning).toBe("boom");
  });

  it("returns null when job does not exist", () => {
    const db = freshDb();
    expect(recordCronHealthRun(db, "nope", { success: true })).toBeNull();
  });

  it("preserves pause/stop status after a run", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, status: "paused" });
    const job = recordCronHealthRun(db, "test-job", { success: true });
    expect(job?.status).toBe("paused");
  });

  it("treats corrupt metadata_json as empty when merging run metadata", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    db.prepare("UPDATE cron_health_jobs SET metadata_json = ? WHERE id = ?").run("{not-json", "test-job");
    const job = recordCronHealthRun(db, "test-job", {
      success: true,
      metadata: { recovered: true },
    });
    expect(job?.metadata).toEqual({ recovered: true });
  });

  it("merges new metadata with existing metadata_json", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, metadata: { team: "platform", version: 1 } });
    const job = recordCronHealthRun(db, "test-job", {
      success: true,
      metadata: { version: 2, region: "us-east-1" },
    });
    expect(job?.metadata).toEqual({
      team: "platform",
      version: 2,
      region: "us-east-1",
    });
  });

  it("returns null for unknown id even after seeding defaults", () => {
    const db = freshDb();
    expect(recordCronHealthRun(db, "ghost", { success: true })).toBeNull();
  });
});

describe("listCronHealthJobs", () => {
  it("seeds defaults before listing — returns 8 jobs even on empty db", () => {
    const db = freshDb();
    expect(listCronHealthJobs(db)).toHaveLength(8);
  });

  it("groups by source_family and emits at least one row per group", () => {
    const db = freshDb();
    ensureDefaultCronJobs(db);
    const jobs = listCronHealthJobs(db);
    const families = new Set(jobs.map((j) => j.sourceFamily));
    expect(families.has("memory")).toBe(true);
    expect(families.has("orchestration")).toBe(true);
    expect(families.has("skills")).toBe(true);
    // Each family has the expected count
    expect(jobs.filter((j) => j.sourceFamily === "memory")).toHaveLength(6);
    expect(jobs.filter((j) => j.sourceFamily === "orchestration")).toHaveLength(1);
    expect(jobs.filter((j) => j.sourceFamily === "skills")).toHaveLength(1);
  });

  it("seeds defaults automatically when called on empty db", () => {
    const db = freshDb();
    expect(listCronHealthJobs(db)).toHaveLength(8);
  });
});

describe("computeHealth (via returned fields)", () => {
  it("paused status → health=paused, caughtUp=true", () => {
    const db = freshDb();
    const job = upsertCronHealthJob(db, { ...sampleJob, status: "paused" });
    expect(job.health).toBe("paused");
    expect(job.caughtUp).toBe(true);
  });

  it("stopped status → health=stopped, caughtUp=false", () => {
    const db = freshDb();
    const job = upsertCronHealthJob(db, { ...sampleJob, status: "stopped" });
    expect(job.health).toBe("stopped");
    expect(job.caughtUp).toBe(false);
  });

  it("warning set → health=warning, caughtUp=false", () => {
    const db = freshDb();
    const job = upsertCronHealthJob(db, { ...sampleJob, warning: "degraded" });
    expect(job.health).toBe("warning");
    expect(job.caughtUp).toBe(false);
  });

  it("active with no last run → health=unknown, caughtUp=false", () => {
    const db = freshDb();
    const job = listCronHealthJobs(db).find((j) => j.id === "memory-consolidation");
    expect(job?.health).toBe("unknown");
    expect(job?.caughtUp).toBe(false);
  });

  it("active with very recent run → health=healthy, caughtUp=true", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    // Use now-1s — within tolerance (5min * 90s = 450s)
    const now = new Date(Date.now() - 1000);
    recordCronHealthRun(db, "test-job", { success: true, now });
    const job = listCronHealthJobs(db).find((j) => j.id === "test-job");
    expect(job?.health).toBe("healthy");
    expect(job?.caughtUp).toBe(true);
  });

  it("active with stale run (over tolerance) → health=warning, caughtUp=false", () => {
    const db = freshDb();
    upsertCronHealthJob(db, { ...sampleJob, expectedIntervalMinutes: 5 });
    // toleranceMs = max(5,1) * 90000 = 450s = 7.5min
    // A run from 60 minutes ago exceeds tolerance
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    recordCronHealthRun(db, "test-job", { success: true, now: stale });
    const job = listCronHealthJobs(db).find((j) => j.id === "test-job");
    expect(job?.health).toBe("warning");
    expect(job?.caughtUp).toBe(false);
  });

  it("last_failure_at set → health=warning, caughtUp=false", () => {
    const db = freshDb();
    upsertCronHealthJob(db, sampleJob);
    recordCronHealthRun(db, "test-job", { success: false });
    const job = listCronHealthJobs(db).find((j) => j.id === "test-job");
    expect(job?.health).toBe("warning");
    expect(job?.caughtUp).toBe(false);
  });
});
