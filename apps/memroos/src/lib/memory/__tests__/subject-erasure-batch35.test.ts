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
    id: `policy-b35-${randomUUID()}`,
    name: "subject batch35",
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

describe("subject-erasure batch35 — identity fingerprint branches", () => {
  it("groups candidates using name scope fingerprint (233)", () => {
    const database = freshDb();
    const displayName = `Person-b35-${randomUUID().slice(0, 6)}`;
    const recordId = `rec-b35-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId,
      ontologyType: "memory.contact",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", name: displayName },
      contentHash: randomUUID(),
      actorId: "operator-b35",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { name: displayName },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b35",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
    expect(planned.candidates?.[0]?.recordCount).toBe(1);
  });

  it("recordMatchesSelectorHashes respects canonicalMemoryId alias (213-214)", () => {
    const database = freshDb();
    const canonicalId = `canon-mem-b35-${randomUUID().slice(0, 8)}`;
    const recordId = `artifact-b35-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        canonicalMemoryId: canonicalId,
      },
      contentHash: randomUUID(),
      actorId: "operator-b35",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const planned = createSubjectErasurePlan(database, {
      subject: { canonicalId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator-b35",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.candidates?.[0]?.canonicalIds.length).toBeGreaterThan(0);
  });
});
