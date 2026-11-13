// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import {
  activeLegalHoldsForRecord,
  createLegalHold,
  releaseLegalHold,
  runRetentionExpiry,
  updateLegalHoldScope,
} from "../retention-expiry";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-${randomUUID()}`,
    name: "expiry batch24",
    ontologyType: "memory.note",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 0,
    priority: 1,
    actorId: "operator",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("retention-expiry batch24 — validation and scope branches", () => {
  it("createLegalHold rejects empty actorId and invalid expiresAt", () => {
    const database = freshDb();
    expect(() =>
      createLegalHold(database, {
        scope: { tenantId: "default-tenant" },
        reasonCode: "litigation",
        actorId: "   ",
      }),
    ).toThrow(/actorId is required/);
    expect(() =>
      createLegalHold(database, {
        scope: { tenantId: "default-tenant" },
        reasonCode: "litigation",
        actorId: "operator",
        expiresAt: "not-a-date",
      }),
    ).toThrow(/Invalid UTC timestamp/);
  });

  it("runRetentionExpiry rejects empty runKey", () => {
    const database = freshDb();
    expect(() =>
      runRetentionExpiry(database, {
        runKey: "   ",
        now: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ).toThrow(/runKey is required/);
  });

  it("activeLegalHoldsForRecord matches array recordId scopes", () => {
    const database = freshDb();
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: "array-hold-target",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    createLegalHold(database, {
      scope: { tenantId: "default-tenant", recordId: ["other-id", "array-hold-target"] },
      reasonCode: "audit",
      actorId: "operator",
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    const row = database
      .prepare(`SELECT * FROM memory_retention_records WHERE record_id = ?`)
      .get("array-hold-target") as import("../retention-policy").RetentionRecordRow;
    const holds = activeLegalHoldsForRecord(database, row, new Date("2026-01-02T00:00:00.000Z"));
    expect(holds).toHaveLength(1);
  });

  it("updateLegalHoldScope and releaseLegalHold throw when hold is missing or inactive", () => {
    const database = freshDb();
    expect(() =>
      updateLegalHoldScope(database, {
        holdId: `missing-${randomUUID()}`,
        scope: { tenantId: "default-tenant" },
        actorId: "operator",
      }),
    ).toThrow(/active legal hold not found/);
    const hold = createLegalHold(database, {
      scope: { tenantId: "default-tenant" },
      reasonCode: "litigation",
      actorId: "operator",
    });
    releaseLegalHold(database, { holdId: hold.id, actorId: "operator" });
    expect(() =>
      releaseLegalHold(database, { holdId: hold.id, actorId: "operator" }),
    ).toThrow(/active legal hold not found/);
  });
});
