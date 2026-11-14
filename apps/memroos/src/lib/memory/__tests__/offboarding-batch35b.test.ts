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

describe("offboarding batch35b — reassigned counts and continuity", () => {
  it("attachPendingPlanToReview counts reassigned messages for user (741)", () => {
    const database = freshDb();
    const userId = `user-reassign-b35b-${randomUUID().slice(0, 8)}`;
    const reviewId = `rev-b35b-${randomUUID()}`;
    const subjectHash = sha256Hex(`subject-b35b-${randomUUID()}`);
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, ?, 'pending_erasure', 'pending', 0, 0, 3600, ?, 'op', ?)`,
      )
      .run(reviewId, subjectHash, userId, "2026-03-05T01:00:00Z", "2026-03-05T00:00:00Z");
    database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${userId}-b35b`, "alpha", "system", "user", "reassign me", "2026-03-05T00:00:00.000Z", "internal", "indexable");
    const receipt = attachPendingPlanToReview(database, {
      reviewId,
      planId: `plan-b35b-${randomUUID()}`,
      actorId: "operator-b35b",
    });
    expect(receipt?.reassignedArtifacts).toBeGreaterThanOrEqual(1);
  });

  it("triggerOffboardingPendingErasure creates review when absent (idempotent false)", () => {
    const database = freshDb();
    const subjectHash = sha256Hex(`subj-new-b35b-${randomUUID()}`);
    const first = triggerOffboardingPendingErasure(database, {
      subjectHash,
      actorId: "operator-b35b",
      scope: { tenantId: "default-tenant", userId: `user-b35b-${randomUUID().slice(0, 6)}` },
    });
    expect(first.idempotent).toBe(false);
    expect(first.reviewId).toBeTruthy();
  });

  it("verifyTombstoneContinuity passes when inventories align", () => {
    const database = freshDb();
    const canonicalId = `canon-b35b-${randomUUID().slice(0, 8)}`;
    const scope = { tenantId: "default-tenant", purpose: "recall" };
    const inventory: SubjectDerivativeInventory[] = [
      { storeId: "message", action: "tombstone", reason: "batch35b", sourceHash: "msg-b35b", provenance: "ingress" },
    ];
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: sha256Hex("subject-ok-b35b"),
      canonicalId,
      recordType: "message",
      recordId: "7",
      recordIdHash: sha256Hex("7"),
      scope,
      derivativeInventory: inventory,
      erasureId: `er-b35b-${randomUUID()}`,
      outcome: "erased",
      actorId: "operator-b35b",
    });
    const aligned = new Map<string, SubjectDerivativeInventory[]>([[`${canonicalId}:7`, inventory]]);
    const report = verifyTombstoneContinuity(database, { derivativeInventories: aligned });
    expect(report.valid).toBe(true);
  });
});
