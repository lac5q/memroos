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
    id: `policy-b35b-${randomUUID()}`,
    name: "subject batch35b",
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

describe("subject-erasure batch35b — selector hashes and scope", () => {
  it("matches records by userId selector hash (204-224)", () => {
    const database = freshDb();
    const userId = `user-subj-b35b-${randomUUID().slice(0, 8)}`;
    const recordId = `rec-user-b35b-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId,
      ontologyType: "memory.contact",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", userId },
      contentHash: randomUUID(),
      actorId: "operator-b35b",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { userId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b35b",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
    expect(planned.plan?.selectorHashes.userId).toBeTruthy();
    expect(planned.plan?.selectorHashes.userId).not.toBe(userId);
  });

  it("recordId selector matches explicit retention record (212)", () => {
    const database = freshDb();
    const recordId = `artifact-b35b-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      contentHash: randomUUID(),
      actorId: "operator-b35b",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { recordId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b35b",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords[0]?.recordId).toBe(recordId);
  });
});
