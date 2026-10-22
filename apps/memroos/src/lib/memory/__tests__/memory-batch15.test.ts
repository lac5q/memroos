// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  OffboardingReviewCompletionError,
  completeOffboardingReview,
  triggerOffboardingPendingErasure,
  verifyTombstoneContinuity,
} from "../offboarding";
import {
  coordinateErasure,
  getErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("memory batch15 — offboarding and erasure branches", () => {
  it("triggerOffboardingPendingErasure propagates transaction failures", () => {
    const database = freshDb();
    vi.spyOn(database, "transaction").mockImplementation(() => {
      throw new Error("offboarding tx failed");
    });
    expect(() =>
      triggerOffboardingPendingErasure(database, {
        tenantId: "default-tenant",
        subjectHash: `subj-${crypto.randomUUID()}`,
        scope: { tenantId: "default-tenant" },
        actorId: "operator",
      }),
    ).toThrow(/offboarding tx failed/);
  });

  it("completeOffboardingReview throws when erasure plans table is unavailable", () => {
    const database = freshDb();
    const reviewId = `rev-${crypto.randomUUID()}`;
    const planId = `plan-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          pending_plan_id, sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'in_progress', 0, 0, ?, 3600, ?, 'op', ?)`,
      )
      .run(reviewId, "subj-table", planId, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
    database.exec("DROP TABLE IF EXISTS memory_subject_erasure_plans");
    expect(() => completeOffboardingReview(database, { reviewId, actorId: "operator" })).toThrow(
      OffboardingReviewCompletionError,
    );
  });

  it("completeOffboardingReview rejects completed plan with non-completed result_json status", () => {
    const database = freshDb();
    const reviewId = `rev-${crypto.randomUUID()}`;
    const planId = `plan-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_offboarding_reviews
         (id, tenant_id, subject_hash, user_id, review_kind, status, revoked_credentials, revoked_agents,
          pending_plan_id, sla_seconds, sla_deadline, created_by, created_at)
         VALUES (?, 'default-tenant', ?, NULL, 'pending_erasure', 'in_progress', 0, 0, ?, 3600, ?, 'op', ?)`,
      )
      .run(reviewId, "subj-result", planId, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
    database
      .prepare(
        `INSERT INTO memory_subject_erasure_plans
         (id, tenant_id, subject_hash, selector_hashes_json, status, scope_json, scope_hash,
          matched_records_json, plan_hash, source_version_hash, result_json, created_by, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, '{}', 'completed', '{}', 'scope', '[]', 'ph', 'sv', ?, 'op', ?, ?)`,
      )
      .run(planId, "subj-result", JSON.stringify({ status: "pending" }), "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    expect(() => completeOffboardingReview(database, { reviewId, actorId: "operator" })).toThrow(
      OffboardingReviewCompletionError,
    );
  });

  it("verifyTombstoneContinuity short-circuits when tombstones table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_tombstones");
    expect(verifyTombstoneContinuity(database, { tenantId: "default-tenant" }).tombstonesChecked).toBe(0);
  });

  it("traverseIndirectDerivatives and embeddings adapter cover synthesis paths", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("neighbor", "message", "ingress", "message");
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "cache")).toBe(true);

    const embIdentity = buildCanonicalIdentity("emb-1", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    embIdentity.derivatives = [{ storeId: "embeddings", sourceHash: embIdentity.canonicalHash, provenance: "test" }];
    const embeddingsAdapter = getErasureStoreAdapter("embeddings");
    const embOutcome = await embeddingsAdapter!.erase(database, "default-tenant", embIdentity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(["purged", "zero_match"]).toContain(embOutcome.status);

    const failIdentity = buildCanonicalIdentity("coord-fail", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    failIdentity.derivatives = [{ storeId: "vault", sourceHash: failIdentity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, failIdentity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.some((o) => o.storeId === "vault")).toBe(true);
  });
});
