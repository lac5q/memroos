// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  listTombstones,
  triggerOffboardingPendingErasure,
  verifyTombstoneContinuity,
  writeTombstoneForErasure,
} from "../offboarding";
import type { SubjectDerivativeInventory } from "../subject-erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

function inventory(): SubjectDerivativeInventory[] {
  return [{ storeId: "vector", action: "purge", reason: "vector_projection", sourceHash: "h1", provenance: "ingress" }];
}

describe("offboarding batch13b — tombstone continuity and validation", () => {
  it("triggerOffboardingPendingErasure requires subjectHash and actorId", () => {
    const database = freshDb();
    expect(() =>
      triggerOffboardingPendingErasure(database, {
        tenantId: "default-tenant",
        subjectHash: "",
        scope: { tenantId: "default-tenant" },
        actorId: "admin",
      })
    ).toThrow(/subjectHash is required/);
    expect(() =>
      triggerOffboardingPendingErasure(database, {
        tenantId: "default-tenant",
        subjectHash: "subj",
        scope: { tenantId: "default-tenant" },
        actorId: "",
      })
    ).toThrow(/actorId is required/);
  });

  it("writeTombstoneForErasure is idempotent on conflict keys", () => {
    const database = freshDb();
    const subjectHash = `subj-${crypto.randomUUID()}`;
    const input = {
      tenantId: "default-tenant",
      subjectHash,
      canonicalId: `canon-${crypto.randomUUID()}`,
      recordType: "message",
      recordId: "42",
      recordIdHash: "abc",
      derivativeInventory: inventory(),
      erasureId: `er-${crypto.randomUUID()}`,
      scope: { tenantId: "default-tenant" },
      outcome: "erased" as const,
      actorId: "admin",
    };
    const first = writeTombstoneForErasure(database, input);
    const second = writeTombstoneForErasure(database, input);
    expect(second.id).toBe(first.id);
    expect(listTombstones(database, { subjectHash }).length).toBe(1);
  });

  it("verifyTombstoneContinuity fails when derivative inventory hash mismatches", () => {
    const database = freshDb();
    const subjectHash = `subj-${crypto.randomUUID()}`;
    const canonicalId = `canon-${crypto.randomUUID()}`;
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash,
      canonicalId,
      recordType: "message",
      recordId: "99",
      recordIdHash: "hash99",
      derivativeInventory: inventory(),
      erasureId: `er-${crypto.randomUUID()}`,
      scope: { tenantId: "default-tenant" },
      outcome: "erased",
      actorId: "admin",
    });
    const map = new Map<string, SubjectDerivativeInventory[]>();
    map.set(`${canonicalId}:99`, [
      { storeId: "fts", action: "purge", reason: "different", sourceHash: "x", provenance: "ingress" },
    ]);
    const report = verifyTombstoneContinuity(database, {
      tenantId: "default-tenant",
      subjectHash,
      derivativeInventories: map,
    });
    expect(report.valid).toBe(false);
    expect(report.reason).toMatch(/derivative_inventory_hash mismatch/);
  });

  it("verifyTombstoneContinuity passes when inventory map matches stored hash", () => {
    const database = freshDb();
    const subjectHash = `subj-${crypto.randomUUID()}`;
    const canonicalId = `canon-${crypto.randomUUID()}`;
    const inv = inventory();
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash,
      canonicalId,
      recordType: "message",
      recordId: "100",
      recordIdHash: "hash100",
      derivativeInventory: inv,
      erasureId: `er-${crypto.randomUUID()}`,
      scope: { tenantId: "default-tenant" },
      outcome: "erased",
      actorId: "admin",
    });
    const map = new Map<string, SubjectDerivativeInventory[]>();
    map.set(`${canonicalId}:100`, inv);
    const report = verifyTombstoneContinuity(database, {
      tenantId: "default-tenant",
      subjectHash,
      derivativeInventories: map,
    });
    expect(report.valid).toBe(true);
    expect(report.tombstonesChecked).toBe(1);
  });

  it("listTombstones returns empty when memory_tombstones table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_tombstones");
    expect(listTombstones(database, { subjectHash: "missing" })).toEqual([]);
  });
});
