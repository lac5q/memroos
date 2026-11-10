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
    id: `policy-b30-${randomUUID()}`,
    name: "subject batch30",
    ontologyType: "*",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 365,
    priority: 1,
    actorId: "operator",
    now: new Date("2026-02-01T00:00:00.000Z"),
  });
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("subject-erasure batch30 — selector branches and name grouping", () => {
  it("plans group records sharing a display name fingerprint (identityFingerprint name path)", () => {
    const database = freshDb();
    const displayName = `Avery B30 ${randomUUID().slice(0, 4)}`;
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-a-${randomUUID()}`, "alpha", "agent", "user", "msg a", "2026-02-01T00:00:00.000Z", "internal", "indexable")
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
      createdAt: "2026-02-01T00:00:00.000Z",
      now: new Date("2026-02-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { name: displayName },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b30",
      now: new Date("2026-02-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
    expect(planned.candidates?.length).toBe(1);
    expect(planned.candidates?.[0]?.recordCount).toBe(1);
  });

  it("returns ambiguous when one name selector matches multiple record fingerprints", () => {
    const database = freshDb();
    const sharedName = `Dana B30 ${randomUUID().slice(0, 4)}`;
    const ids = [randomUUID(), randomUUID()].map((session) =>
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(`sess-${session}`, "alpha", "agent", "user", "body", "2026-02-01T00:00:00.000Z", "internal", "indexable")
        .lastInsertRowid as number,
    );

    for (const messageId of ids) {
      registerRetentionRecord(database, {
        recordType: "message",
        recordId: String(messageId),
        ontologyType: "memory.contact_event",
        securityLabel: { visibility: "internal", name: sharedName },
        purpose: "recall",
        scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", name: sharedName },
        contentHash: randomUUID(),
        actorId: "operator",
        createdAt: "2026-02-01T00:00:00.000Z",
        now: new Date("2026-02-01T00:00:00.000Z"),
      });
    }

    const ambiguous = createSubjectErasurePlan(database, {
      subject: { name: sharedName },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b30",
      now: new Date("2026-02-02T00:00:00.000Z"),
    });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.reason).toBe("ambiguous_subject_selector");
    expect(ambiguous.candidates?.length).toBe(2);
  });
});
