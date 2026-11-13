// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { sha256Hex, stableJson } from "@/lib/memory/retention-policy";
import {
  attachPendingPlanToReview,
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

function tombstoneInput(
  canonicalId: string,
  recordId: string,
  subjectHashSeed: string,
  inventory: SubjectDerivativeInventory[],
) {
  return {
    tenantId: "default-tenant",
    subjectHash: sha256Hex(subjectHashSeed),
    canonicalId,
    recordType: "message",
    recordId,
    recordIdHash: sha256Hex(recordId),
    scope: { tenantId: "default-tenant", purpose: "recall" },
    derivativeInventory: inventory,
    erasureId: `er-b36-${randomUUID()}`,
    outcome: "erased" as const,
    actorId: "operator-b36",
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("offboarding batch36 — continuity mismatch and reassigned zero", () => {
  it("verifyTombstoneContinuity fails on derivative_inventory_hash mismatch (721-727)", () => {
    const database = freshDb();
    const canonicalId = `canon-b36-${randomUUID().slice(0, 8)}`;
    const inventory: SubjectDerivativeInventory[] = [
      { storeId: "message", action: "tombstone", reason: "batch36", sourceHash: "msg-b36", provenance: "ingress" },
    ];
    writeTombstoneForErasure(database, tombstoneInput(canonicalId, "42", "subject-mismatch-b36", inventory));
    const mismatchInventory: SubjectDerivativeInventory[] = [
      { storeId: "vault", action: "purge", reason: "different", sourceHash: "vault-b36", provenance: "ingress" },
    ];
    const check = verifyTombstoneContinuity(database, {
      derivativeInventories: new Map([[`${canonicalId}:42`, mismatchInventory]]),
    });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/derivative_inventory_hash mismatch/i);
  });

  it("attachPendingPlanToReview returns zero reassigned when userId missing (740)", () => {
    const database = freshDb();
    const reviewId = `rev-b36-${randomUUID()}`;
    const subjectHash = sha256Hex(`subject-b36-${randomUUID()}`);
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'pending', 0, 0, 3600, ?, 'op', ?)`,
      )
      .run(reviewId, subjectHash, "2026-03-06T01:00:00Z", "2026-03-06T00:00:00Z");
    const receipt = attachPendingPlanToReview(database, {
      reviewId,
      planId: `plan-b36-${randomUUID()}`,
      actorId: "operator-b36",
    });
    expect(receipt?.reassignedArtifacts).toBe(0);
  });

  it("verifyTombstoneContinuity passes when expected inventory hash matches stored tombstone", () => {
    const database = freshDb();
    const canonicalId = `canon-ok-b36-${randomUUID().slice(0, 8)}`;
    const inventory: SubjectDerivativeInventory[] = [
      { storeId: "message", action: "tombstone", reason: "batch36", sourceHash: "ok-b36", provenance: "ingress" },
    ];
    writeTombstoneForErasure(database, tombstoneInput(canonicalId, "7", "subject-ok-b36", inventory));
    const expectedHash = sha256Hex(
      stableJson(
        inventory.map((item) => ({
          storeId: item.storeId,
          action: item.action,
          reason: item.reason,
        })),
      ),
    );
    const check = verifyTombstoneContinuity(database, {
      derivativeInventories: new Map([[`${canonicalId}:7`, inventory]]),
    });
    expect(check.valid).toBe(true);
    expect(expectedHash.length).toBeGreaterThan(10);
  });
});
