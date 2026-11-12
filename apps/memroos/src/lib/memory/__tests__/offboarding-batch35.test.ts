// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { sha256Hex } from "@/lib/memory/retention-policy";
import {
  attachPendingPlanToReview,
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

describe("offboarding batch35 — reassigned counts and tombstone continuity", () => {
  it("countReassignedArtifacts returns zero when messages table is missing (741)", () => {
    const database = freshDb();
    const userId = `user-b35-${randomUUID().slice(0, 8)}`;
    const reviewId = `rev-b35-${randomUUID()}`;
    const subjectHash = sha256Hex("subject-b35");
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, ?, 'pending_erasure', 'pending', 0, 0, 3600, ?, 'op', ?)`,
      )
      .run(reviewId, subjectHash, userId, "2026-03-05T01:00:00Z", "2026-03-05T00:00:00Z");
    database.exec("DROP TABLE messages");

    const receipt = attachPendingPlanToReview(database, {
      reviewId,
      planId: `plan-b35-${randomUUID()}`,
      actorId: "operator-b35",
    });
    expect(receipt?.reassignedArtifacts).toBe(0);
  });

  it("idempotent offboarding skips reassigned count when userId is absent (740)", () => {
    const database = freshDb();
    const subjectHash = sha256Hex(`subj-b35-${randomUUID()}`);
    const first = triggerOffboardingPendingErasure(database, {
      subjectHash,
      actorId: "operator-b35",
      scope: { tenantId: "default-tenant" },
    });
    const second = triggerOffboardingPendingErasure(database, {
      subjectHash,
      actorId: "operator-b35",
      scope: { tenantId: "default-tenant" },
    });
    expect(second.idempotent).toBe(true);
    expect(first.reassignedArtifacts).toBe(0);
    expect(second.reassignedArtifacts).toBe(0);
  });

  it("verifyTombstoneContinuity flags derivative_inventory_hash mismatch (721-727)", () => {
    const database = freshDb();
    const canonicalId = `canon-b35-${randomUUID().slice(0, 8)}`;
    const scope = { tenantId: "default-tenant", purpose: "recall" };
    const inventory: SubjectDerivativeInventory[] = [
      { storeId: "fts", action: "purge", reason: "batch35", sourceHash: "fts-b35", provenance: "ingress" },
    ];
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: sha256Hex("subject-tomb-b35"),
      canonicalId,
      recordType: "message",
      recordId: "42",
      recordIdHash: sha256Hex("42"),
      scope,
      derivativeInventory: inventory,
      erasureId: `er-b35-${randomUUID()}`,
      outcome: "erased",
      actorId: "operator-b35",
    });

    const wrong = new Map<string, SubjectDerivativeInventory[]>([
      [
        `${canonicalId}:42`,
        [{ storeId: "vector", action: "purge", reason: "mismatch", sourceHash: "v-b35", provenance: "ingress" }],
      ],
    ]);
    const report = verifyTombstoneContinuity(database, { derivativeInventories: wrong });
    expect(report.valid).toBe(false);
    expect(report.reason).toMatch(/derivative_inventory_hash mismatch/);
  });
});
