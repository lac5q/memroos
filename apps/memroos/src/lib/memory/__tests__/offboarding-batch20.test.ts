// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { attachPendingPlanToReview, completeOffboardingReview } from "../offboarding";

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

describe("offboarding batch20 — plan attachment and reassigned artifact counts", () => {
  it("attachPendingPlanToReview returns null when review row is missing", () => {
    const database = freshDb();
    expect(
      attachPendingPlanToReview(database, {
        reviewId: `rev-missing-${crypto.randomUUID()}`,
        planId: "plan-1",
        actorId: "operator",
      }),
    ).toBeNull();
  });

  it("attachPendingPlanToReview counts reassigned artifacts for user-scoped sessions", () => {
    const database = freshDb();
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const reviewId = `rev-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, ?, 'pending_erasure', 'pending', 0, 0, 3600, ?, 'op', ?)`,
      )
      .run(reviewId, `subj-${crypto.randomUUID()}`, userId, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
    database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'p', 'system', 'user', 'reassigned', '2026-01-01T00:00:00.000Z', 'internal', 'indexable')`,
      )
      .run(`offboard-${userId}-session`);
    const receipt = attachPendingPlanToReview(database, {
      reviewId,
      planId: `plan-${crypto.randomUUID()}`,
      actorId: "operator",
    });
    expect(receipt?.status).toBe("in_progress");
    expect(receipt?.reassignedArtifacts).toBe(1);
  });

  it("completeOffboardingReview returns null when reviews table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_offboarding_reviews");
    expect(
      completeOffboardingReview(database, {
        reviewId: `rev-${crypto.randomUUID()}`,
        actorId: "operator",
      }),
    ).toBeNull();
  });
});
