// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as erasureModule from "@/lib/memory/erasure";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import {
  approveSubjectErasurePlan,
  createSubjectErasurePlan,
  executeSubjectErasurePlan,
} from "../subject-erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-${randomUUID()}`,
    name: "subject batch26",
    ontologyType: "*",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 365,
    priority: 1,
    actorId: "operator",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("subject-erasure batch26 — name fingerprint, execution guards, coordinator failures", () => {
  it("createSubjectErasurePlan groups records by name fingerprint when name is the only selector", () => {
    const database = freshDb();
    const displayName = `Taylor Batch26 ${randomUUID().slice(0, 4)}`;
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "name match", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal", name: displayName },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", name: displayName },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { name: displayName },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
    expect(planned.candidates?.length).toBe(1);
  });

  it("executeSubjectErasurePlan rejects plan hash mismatch before running coordinator", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "hash guard", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    const subjectId = `subject-hash-b26-${randomUUID().slice(0, 6)}`;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        subjectId,
      },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    approveSubjectErasurePlan(database, {
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    let message = "";
    try {
      await executeSubjectErasurePlan(database, {
        planId: planned.plan.id,
        planHash: `${planned.plan.planHash}-tampered`,
        actorId: "operator",
        now: new Date("2026-01-04T00:00:00.000Z"),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/plan hash mismatch/);
  });

  it("executeSubjectErasurePlan records coordinator failures without aborting the whole plan", async () => {
    const database = freshDb();
    const subjectId = `subject-coord-fail-${randomUUID().slice(0, 6)}`;
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "coord fail", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", subjectId },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    approveSubjectErasurePlan(database, {
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    vi.spyOn(erasureModule, "coordinateErasure").mockRejectedValue(new Error("coordinator_down_batch26"));

    const executed = await executeSubjectErasurePlan(database, {
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    expect(executed.failed).toBeGreaterThan(0);
    expect(
      executed.storeOutcomes.some((item) =>
        item.outcomes.some((o) => o.storeId === "coordinator" && o.status === "failed" && o.reason.includes("coordinator_down_batch26")),
      ),
    ).toBe(true);
  });
});
