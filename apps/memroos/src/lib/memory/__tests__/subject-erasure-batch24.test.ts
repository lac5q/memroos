// @vitest-environment node
import { randomUUID } from "node:crypto";
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
    id: `policy-${randomUUID()}`,
    name: "subject batch24",
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

describe("subject-erasure batch24 — name fingerprint, candidate erase, hash guard", () => {
  it("createSubjectErasurePlan matches records by name selector fingerprint", () => {
    const database = freshDb();
    const captureId = randomUUID();
    const candidateId = randomUUID();
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess', 'ch', '2026-01-01T00:00:00Z')`,
      )
      .run(captureId);
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent', 'lesson', 'candidate body', ?, 'candidate', '{}', '2026-01-01T00:00:00Z')`,
      )
      .run(candidateId, captureId, randomUUID());
    registerRetentionRecord(database, {
      recordType: "agent_memory_candidate",
      recordId: candidateId,
      ontologyType: "memory.lesson",
      securityLabel: { visibility: "internal", name: "Taylor Batch24" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        name: "Taylor Batch24",
      },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { name: "Taylor Batch24" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.some((r) => r.recordType === "agent_memory_candidate")).toBe(true);
  });

  it("executeSubjectErasurePlan erases agent_memory_candidate payload after approval", async () => {
    const database = freshDb();
    const captureId = randomUUID();
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess', 'ch', '2026-01-01T00:00:00Z')`,
      )
      .run(captureId);
    const candidateId = randomUUID();
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent', 'lesson', 'erase candidate b24', ?, 'candidate', '{}', '2026-01-01T00:00:00Z')`,
      )
      .run(candidateId, captureId, randomUUID());
    registerRetentionRecord(database, {
      recordType: "agent_memory_candidate",
      recordId: candidateId,
      ontologyType: "memory.lesson",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        subjectId: "subject-candidate-b24",
      },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-candidate-b24" },
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
    const row = database
      .prepare(`SELECT content, status FROM agent_memory_candidates WHERE id = ?`)
      .get(candidateId) as { content: string; status: string };
    expect(row.content).toBe("[erased]");
    expect(row.status).toBe("rejected");
  });

  it("approveSubjectErasurePlan rejects plan hash mismatch before execution", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        `sess-${randomUUID()}`,
        "alpha",
        "agent",
        "user",
        "hash mismatch b24",
        "2026-01-01T00:00:00.000Z",
        "internal",
        "indexable",
      ).lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        subjectId: "subject-hash-b24",
      },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-hash-b24" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    expect(() =>
      approveSubjectErasurePlan(database, {
        tenantId: "default-tenant",
        planId: planned.plan!.id,
        planHash: "f".repeat(64),
        actorId: "operator",
        now: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ).toThrow(/plan hash mismatch/);
  });
});
