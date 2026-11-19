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
    name: "subject batch17",
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

describe("subject-erasure batch17 — scope matching, federation, execution", () => {
  it("createSubjectErasurePlan rejects blank actorId", () => {
    const database = freshDb();
    registerMessage(database, "subject-actor");
    expect(() =>
      createSubjectErasurePlan(database, {
        subject: { subjectId: "subject-actor" },
        scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
        actorId: "   ",
      }),
    ).toThrow(/actorId is required/);
  });

  it("createSubjectErasurePlan rejects empty scope object", () => {
    const database = freshDb();
    const result = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-scope" },
      scope: {} as never,
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_scope");
  });

  it("scope array filters exclude non-matching projects", () => {
    const database = freshDb();
    registerMessage(database, "subject-array", { project: "beta" });
    registerMessage(database, "subject-array", { project: "alpha" });
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-array" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: ["alpha"] },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.plan?.matchedRecords).toHaveLength(1);
  });

  it("wildcard scope keys match any project value", () => {
    const database = freshDb();
    registerMessage(database, "subject-wild", { project: "gamma" });
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-wild" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "*" },
      actorId: "operator",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.plan?.matchedRecords).toHaveLength(1);
  });

  it("approveSubjectErasurePlan throws when now is invalid", () => {
    const database = freshDb();
    registerMessage(database, "subject-ts");
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-ts" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(() =>
      approveSubjectErasurePlan(database, {
        planId: plan.plan!.id,
        planHash: plan.plan!.planHash,
        actorId: "operator",
        now: "bad-ts" as never,
      }),
    ).toThrow(/Invalid UTC timestamp/);
  });

  it("createSubjectErasurePlan records excluded records for subject selector mismatches", () => {
    const database = freshDb();
    registerMessage(database, "subject-excluded", { project: "alpha" });
    registerMessage(database, "other-subject", { project: "alpha" });
    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-excluded" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.plan?.matchedRecords).toHaveLength(1);
    expect((plan.plan?.excludedRecords ?? []).length).toBeGreaterThan(0);
  });
});
