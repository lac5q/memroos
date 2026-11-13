// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import { activeLegalHoldsForRecord, createLegalHold } from "../retention-expiry";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-b33-${randomUUID()}`,
    name: "expiry batch33",
    ontologyType: "memory.note",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 30,
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

describe("retention-expiry batch33 — matchesScope recordType and wildcard keys", () => {
  it("activeLegalHoldsForRecord matches recordType scope keys (73, 77-78)", () => {
    const database = freshDb();
    registerRetentionRecord(database, {
      recordType: "artifact",
      recordId: `artifact-b33-${randomUUID().slice(0, 8)}`,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const row = database
      .prepare(`SELECT * FROM memory_retention_records WHERE record_type = 'artifact' LIMIT 1`)
      .get() as import("../retention-policy").RetentionRecordRow;

    createLegalHold(database, {
      scope: { tenantId: "default-tenant", recordType: "artifact" },
      reasonCode: "audit-b33",
      actorId: "operator",
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    createLegalHold(database, {
      scope: { tenantId: "default-tenant", recordType: "message" },
      reasonCode: "wrong-type",
      actorId: "operator",
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    const holds = activeLegalHoldsForRecord(database, row, new Date("2026-03-02T00:00:00.000Z"));
    expect(holds).toHaveLength(1);
    expect(holds[0]?.reason_code).toBe("audit-b33");
  });

  it("matchesScope skips wildcard and empty expected values (73, 83)", () => {
    const database = freshDb();
    const recordId = `hold-target-b33-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha", spaceId: "team-a" },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const row = database
      .prepare(`SELECT * FROM memory_retention_records WHERE record_id = ?`)
      .get(recordId) as import("../retention-policy").RetentionRecordRow;

    createLegalHold(database, {
      scope: {
        tenantId: "default-tenant",
        project: "*",
        purpose: "",
        recordId: ["other", recordId],
      },
      reasonCode: "wildcard-b33",
      actorId: "operator",
    });

    const holds = activeLegalHoldsForRecord(database, row, new Date("2026-03-02T00:00:00.000Z"));
    expect(holds).toHaveLength(1);
  });
});
