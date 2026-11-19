// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

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
    name: "subject batch23b",
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
  db?.close();
  db = null;
});

describe("subject-erasure batch23b — approved plan execution", () => {
  it("executeSubjectErasurePlan erases matched message rows after approval", async () => {
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
        "erase-me-b23b",
        "2026-01-01T00:00:00.000Z",
        "internal",
        "indexable",
      ).lastInsertRowid as number;

    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal", name: "Taylor Batch23B" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        subjectId: "subject-msg-b23b",
      },
      contentHash: `hash-${messageId}`,
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-msg-b23b" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");

    approveSubjectErasurePlan(database, {
      tenantId: "default-tenant",
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    const executed = await executeSubjectErasurePlan(database, {
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    expect(executed.erased).toBeGreaterThan(0);
    const row = database.prepare(`SELECT content FROM messages WHERE id = ?`).get(messageId) as { content: string };
    expect(row.content).toBe("[erased]");
  });
});
