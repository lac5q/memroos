// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import { createSubjectErasurePlan } from "../subject-erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-b34-${randomUUID()}`,
    name: "subject batch34",
    ontologyType: "*",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 365,
    priority: 1,
    actorId: "operator",
    now: new Date("2026-03-01T00:00:00.000Z"),
  });
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("subject-erasure batch34 — scope validation and fingerprint branches", () => {
  it("rejects plans missing tenant scope (174-177)", () => {
    const database = freshDb();
    const planned = createSubjectErasurePlan(database, {
      subject: { name: `name-b34-${randomUUID().slice(0, 8)}` },
      scope: { tenantId: "", purpose: "recall", project: "alpha" } as { tenantId: string; purpose: string; project: string },
      actorId: "operator-b34",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(false);
    expect(planned.reason).toBe("missing_tenant");
  });

  it("identity fingerprint uses canonicalId when present (228-234)", () => {
    const database = freshDb();
    const canonicalId = `canon-b34-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId: `rec-b34-${randomUUID().slice(0, 8)}`,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", canonicalId },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { canonicalId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b34",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.candidates?.[0]?.candidateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("scopeMatches honors recordType and ontologyType filters (189-193)", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b34-${randomUUID()}`, "alpha", "agent", "user", "scoped", "2026-03-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { recordId: String(messageId) },
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        recordType: "message",
        ontologyType: "memory.contact_event",
      },
      actorId: "operator-b34",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
  });
});
