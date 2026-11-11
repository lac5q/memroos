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
    id: `policy-b31-${randomUUID()}`,
    name: "subject batch31",
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

describe("subject-erasure batch31 — fingerprint and selector branches", () => {
  it("plans resolve records by recordId selector without display name (identity fingerprint path)", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b31-${randomUUID()}`, "alpha", "agent", "user", "record-id-b31", "2026-03-01T00:00:00.000Z", "internal", "indexable")
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
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b31",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
    expect(planned.candidates?.length).toBe(1);
    expect(planned.candidates?.[0]?.candidateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns denied when selector hashes match no scoped records", () => {
    const database = freshDb();
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: `missing-b31-${randomUUID().slice(0, 8)}` },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b31",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(false);
    expect(planned.status).toBe("denied");
    expect(planned.reason).toBe("subject_not_found");
  });
});
