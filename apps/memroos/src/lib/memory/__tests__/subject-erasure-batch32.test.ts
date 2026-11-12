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
    id: `policy-b32-${randomUUID()}`,
    name: "subject batch32",
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

describe("subject-erasure batch32 — identity fingerprint name fallback", () => {
  it("groups records by display name when exact subject ids are absent (line 233)", () => {
    const database = freshDb();
    const displayName = `display-b32-${randomUUID().slice(0, 8)}`;
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b32-${randomUUID()}`, "alpha", "agent", "user", "name-only", "2026-03-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;

    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", name: displayName },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { name: displayName },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b32",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.candidates?.length).toBe(1);
    expect(planned.candidates?.[0]?.recordCount).toBe(1);
    expect(planned.plan?.matchedRecords.length).toBe(1);
  });
});
