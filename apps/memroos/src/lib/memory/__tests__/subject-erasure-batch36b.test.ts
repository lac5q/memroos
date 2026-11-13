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
    id: `policy-b36b-${randomUUID()}`,
    name: "subject batch36b",
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

describe("subject-erasure batch36b — identity fingerprint fallback (233–234)", () => {
  it("groups records lacking exact subject fields via name fingerprint", () => {
    const database = freshDb();
    const displayName = `Taylor B36b ${randomUUID().slice(0, 6)}`;
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId: `rec-b36b-${randomUUID().slice(0, 6)}`,
      ontologyType: "memory.contact",
      securityLabel: { visibility: "internal", name: displayName },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", name: displayName },
      contentHash: randomUUID(),
      actorId: "operator-b36b",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(database, {
      subject: { name: displayName },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b36b",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
  });
});
