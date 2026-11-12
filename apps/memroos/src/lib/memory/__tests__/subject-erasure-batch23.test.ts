// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
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
    id: `policy-${crypto.randomUUID()}`,
    name: "subject batch23",
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

describe("subject-erasure batch23 — approve guards and candidate erasure", () => {
  it("approveSubjectErasurePlan rejects non-planned status", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        `sess-${crypto.randomUUID()}`,
        "alpha",
        "agent",
        "user",
        "erase-me",
        "2026-01-01T00:00:00.000Z",
        "internal",
        "indexable",
      ).lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", subjectId: "subject-b23" },
      contentHash: `hash-${messageId}`,
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-b23" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    database
      .prepare(`UPDATE memory_subject_erasure_plans SET status = 'approved' WHERE id = ?`)
      .run(planned.plan.id);
    expect(() =>
      approveSubjectErasurePlan(database, {
        planId: planned.plan.id,
        planHash: planned.plan.planHash,
        actorId: "operator",
        now: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ).toThrow(/cannot be approved from status approved/);
  });

  it("executeSubjectErasurePlan rejects when plan is not approved", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        `sess-${crypto.randomUUID()}`,
        "alpha",
        "agent",
        "user",
        "erase-me",
        "2026-01-01T00:00:00.000Z",
        "internal",
        "indexable",
      ).lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", subjectId: "subject-exec-b23" },
      contentHash: `hash-${messageId}`,
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-exec-b23" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    let message = "";
    try {
      await executeSubjectErasurePlan(database, {
        planId: planned.plan.id,
        planHash: planned.plan.planHash,
        actorId: "operator",
        now: new Date("2026-01-04T00:00:00.000Z"),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/cannot execute from status planned/);
  });
});
