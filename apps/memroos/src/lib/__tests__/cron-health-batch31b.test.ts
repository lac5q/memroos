// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { listCronHealthJobs, upsertCronHealthJob } from "@/lib/cron-health";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("cron-health batch31b — parseJson and invalid run timestamps", () => {
  it("parseJson treats array metadata as empty object (line 94)", () => {
    const db = freshDb();
    const id = `job-b31b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO cron_health_jobs
        (id, name, source_family, schedule, owner, status, expected_interval_minutes, metadata_json, updated_at)
       VALUES (?, 'Array metadata', 'memory', 'hourly', 'memroos', 'active', 60, ?, datetime('now'))`,
    ).run(id, JSON.stringify(["not", "object"]));
    const job = listCronHealthJobs(db).find((row) => row.id === id);
    expect(job?.metadata).toEqual({});
    db.close();
  });

  it("computeHealth marks unknown when last_run_at is not finite (line 122)", () => {
    const db = freshDb();
    const id = `job-invalid-date-${randomUUID().slice(0, 8)}`;
    upsertCronHealthJob(db, {
      id,
      name: "Invalid last run",
      sourceFamily: "memory",
      schedule: "hourly",
      expectedIntervalMinutes: 60,
      lastRunAt: "not-a-date",
    });
    const job = listCronHealthJobs(db).find((row) => row.id === id);
    expect(job?.health).toBe("unknown");
    expect(job?.caughtUp).toBe(false);
    db.close();
  });
});
