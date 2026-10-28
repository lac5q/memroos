// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import { approveSubjectErasurePlan, createSubjectErasurePlan } from "../subject-erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-${crypto.randomUUID()}`,
    name: "subject batch20",
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

function registerMessage(
  database: Database.Database,
  subjectId: string,
  scopeExtras: Record<string, unknown> = {},
): number {
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
    scope: {
      tenantId: "default-tenant",
      purpose: "recall",
      project: "alpha",
      subjectId,
      ...scopeExtras,
    },
    contentHash: `hash-${messageId}`,
    actorId: "operator",
    createdAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return messageId;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("subject-erasure batch20 — federation derivatives, stale approval, scope filters", () => {
  it("message derivative inventory marks embeddings purge when local row exists", () => {
    const database = freshDb();
    const subjectId = `subject-embed-b20-${crypto.randomUUID().slice(0, 8)}`;
    const messageId = registerMessage(database, subjectId);
    database
      .prepare(`INSERT INTO message_embeddings (message_id, model, dim, vector) VALUES (?, ?, ?, ?)`)
      .run(messageId, "text-embedding-test", 3, Buffer.from(Float32Array.from([0.1, 0.2, 0.3]).buffer));
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const embeddings = plan.plan?.matchedRecords[0]?.derivatives.find((d) => d.storeId === "embeddings");
    expect(embeddings?.action).toBe("purge");
  });

  it("approveSubjectErasurePlan rejects stale plan after retention records change", () => {
    const database = freshDb();
    const subjectId = `subject-stale-${crypto.randomUUID().slice(0, 8)}`;
    registerMessage(database, subjectId);
    const planned = createSubjectErasurePlan(database, {
      id: `plan-stale-${crypto.randomUUID().slice(0, 8)}`,
      subject: { subjectId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    registerMessage(database, subjectId);
    expect(() =>
      approveSubjectErasurePlan(database, {
        planId: planned.plan.id,
        planHash: planned.plan.planHash,
        actorId: "operator",
        now: new Date("2026-01-04T00:00:00.000Z"),
      }),
    ).toThrow(/stale/);
  });

  it("scope array filters keep only records in allowed project values", () => {
    const database = freshDb();
    registerMessage(database, "subject-array-b20", { project: "beta" });
    registerMessage(database, "subject-array-b20", { project: "alpha" });
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-array-b20" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: ["alpha"] },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.plan?.matchedRecords).toHaveLength(1);
  });

  it("createSubjectErasurePlan records excluded records for subject selector mismatches", () => {
    const database = freshDb();
    registerMessage(database, "subject-excluded-b20", { project: "alpha" });
    registerMessage(database, "other-subject-b20", { project: "alpha" });
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-excluded-b20" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.plan?.matchedRecords).toHaveLength(1);
    expect((plan.plan?.excludedRecords ?? []).length).toBeGreaterThan(0);
  });
});
