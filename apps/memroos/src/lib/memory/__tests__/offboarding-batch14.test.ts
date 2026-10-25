// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  OffboardingReviewCompletionError,
  attachPendingPlanToReview,
  completeOffboardingReview,
  triggerOffboardingPendingErasure,
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

describe("offboarding batch14 — review lifecycle and tombstones", () => {
  it("attachPendingPlanToReview returns null when reviews table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_offboarding_reviews");
    expect(
      attachPendingPlanToReview(database, {
        reviewId: `rev-${crypto.randomUUID()}`,
        planId: "plan-1",
        actorId: "operator",
      })
    ).toBeNull();
  });

  it("attachPendingPlanToReview moves pending review to in_progress", () => {
    const database = freshDb();
    const subjectHash = `subj-${crypto.randomUUID()}`;
    const reviewId = `rev-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'pending', 0, 0, 3600, ?, 'op', ?)`
      )
      .run(reviewId, subjectHash, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
    const receipt = attachPendingPlanToReview(database, {
      reviewId,
      planId: `plan-${crypto.randomUUID()}`,
      actorId: "operator",
    });
    expect(receipt?.status).toBe("in_progress");
    expect(receipt?.pendingPlanId).toBeTruthy();
  });

  it("completeOffboardingReview is idempotent when review already completed", () => {
    const database = freshDb();
    const reviewId = `rev-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          pending_plan_id, sla_seconds, sla_deadline, created_by, created_at, completed_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'completed', 1, 2, 'plan-x', 3600, ?, 'op', ?, ?)`
      )
      .run(reviewId, "subj-done", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z");
    const receipt = completeOffboardingReview(database, { reviewId, actorId: "operator" });
    expect(receipt?.idempotent).toBe(true);
    expect(receipt?.status).toBe("completed");
  });

  it("completeOffboardingReview refuses completion without attached plan", () => {
    const database = freshDb();
    const reviewId = `rev-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          pending_plan_id, sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'pending', 0, 0, NULL, 3600, ?, 'op', ?)`
      )
      .run(reviewId, "subj-noplan", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
    expect(() => completeOffboardingReview(database, { reviewId, actorId: "operator" })).toThrow(
      OffboardingReviewCompletionError
    );
  });

  it("completeOffboardingReview rejects malformed erasure result_json", () => {
    const database = freshDb();
    const reviewId = `rev-${crypto.randomUUID()}`;
    const planId = `plan-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          pending_plan_id, sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'in_progress', 0, 0, ?, 3600, ?, 'op', ?)`
      )
      .run(reviewId, "subj-bad-json", planId, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
    database
      .prepare(
        `INSERT INTO memory_subject_erasure_plans
         (id, tenant_id, subject_hash, selector_hashes_json, status, scope_json, scope_hash,
          matched_records_json, plan_hash, source_version_hash, result_json, created_by, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, '{}', 'completed', '{}', 'scope', '[]', 'ph', 'sv', 'not-json{{', 'op', ?, ?)`
      )
      .run(planId, "subj-bad-json", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    expect(() => completeOffboardingReview(database, { reviewId, actorId: "operator" })).toThrow(
      OffboardingReviewCompletionError
    );
  });

  it("writeTombstoneForErasure throws when memory_tombstones table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_tombstones");
    expect(() =>
      writeTombstoneForErasure(database, {
        tenantId: "default-tenant",
        subjectHash: "subj",
        canonicalId: "canon",
        recordType: "message",
        recordId: "1",
        recordIdHash: "h",
        derivativeInventory: inventory(),
        erasureId: `er-${crypto.randomUUID()}`,
        scope: { tenantId: "default-tenant" },
        outcome: "erased",
        actorId: "admin",
      })
    ).toThrow(/memory_tombstones table missing/);
  });

  it("triggerOffboardingPendingErasure counts reassigned messages for userId", () => {
    const database = freshDb();
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(`INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, 'x')`)
      .run(userId, `${userId}@example.com`, userId);
    database
      .prepare(
        `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
         VALUES (?, 'p', ?, 'user', 'hello', '2026-01-01T00:00:00Z')`
      )
      .run(`sess-${userId}`, userId);
    const receipt = triggerOffboardingPendingErasure(database, {
      tenantId: "default-tenant",
      subjectHash: `subj-${crypto.randomUUID()}`,
      userId,
      scope: { tenantId: "default-tenant" },
      actorId: "operator",
    });
    expect(receipt.reassignedArtifacts).toBeGreaterThanOrEqual(1);
  });
});
