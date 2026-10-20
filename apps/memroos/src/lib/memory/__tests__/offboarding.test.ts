// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  attachPendingPlanToReview,
  completeOffboardingReview,
  listTombstones,
  OffboardingReviewCompletionError,
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

function makeDerivativeInventory(): SubjectDerivativeInventory[] {
  return [
    { storeId: "vector", action: "purge", reason: "vector_projection", sourceHash: "h1", provenance: "ingress" },
    { storeId: "fts", action: "purge", reason: "fts_projection", sourceHash: "h1", provenance: "ingress" },
    { storeId: "vault", action: "tombstone", reason: "vault_tombstoned", sourceHash: "h1", provenance: "ingress" },
  ];
}

describe("VAL-MEM-028: offboarding triggers but does not fake erasure", () => {
  it("creates a pending MEMLIFE review without claiming erasure complete", () => {
    const database = freshDb();
    const receipt = triggerOffboardingPendingErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-1",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      actorId: "admin",
    });
    expect(receipt.status).toBe("pending");
    expect(receipt.idempotent).toBe(false);
    expect(receipt.subjectHash).toBe("subject-hash-1");

    // Re-running with the same subjectHash returns the SAME review (idempotent).
    const second = triggerOffboardingPendingErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-1",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      actorId: "admin",
    });
    expect(second.idempotent).toBe(true);
    expect(second.reviewId).toBe(receipt.reviewId);

    // And the row in memory_offboarding_reviews must NOT be completed.
    const row = database
      .prepare("SELECT status FROM memory_offboarding_reviews WHERE id = ?")
      .get(receipt.reviewId) as { status: string };
    expect(row.status).toBe("pending");
  });

  it("revokes user_api_keys and deregisters agents when userId is supplied", () => {
    const database = freshDb();
    // Set up the user and agent tables manually (initSchema already created them).
    database
      .prepare(`INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("usr_offboard_1", "offboard@test.com", "Leaver", "hash", "default-tenant", "2026-01-01T00:00:00.000Z");
    database
      .prepare(`INSERT INTO user_api_keys (id, user_id, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run("uak_1", "usr_offboard_1", "hash1", "leaver key", "2026-01-01T00:00:00.000Z");
    database
      .prepare(`INSERT INTO registered_agents (id, name, role, platform, protocol, status, location, metadata, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("agt_offboard_1", "agent-1", "operator", "custom", "local", "active", "local", "{}", "usr_offboard_1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    database
      .prepare(`INSERT INTO agent_api_keys (agent_id, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?)`)
      .run("agt_offboard_1", "agt_prefix_1", "hash2", "2026-01-01T00:00:00.000Z");
    const skillId = database
      .prepare(`INSERT INTO skill_registry (name, source_harness, raw_body, imported_by) VALUES (?, ?, ?, ?)`)
      .run("offboard-skill", "local", "governed body", "operator").lastInsertRowid as number;
    database
      .prepare(`INSERT INTO skill_version_pins (agent_id, skill_name, skill_id, current_version, current_content_hash, actor) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("agt_offboard_1", "offboard-skill", skillId, "1.0.0", "hash", "operator");
    database
      .prepare(`INSERT INTO skill_dependencies (skill_id, dependent_agent_id, skill_version, registered_by) VALUES (?, ?, ?, ?)`)
      .run(skillId, "agt_offboard_1", "1.0.0", "operator");
    database
      .prepare(`INSERT INTO messages (session_id, project, agent_id, role, content, timestamp, visibility, policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("sess-1", "alpha", "usr_offboard_1", "user", "leaver content", "2026-01-01T00:00:00.000Z", "internal", "indexable");

    const receipt = triggerOffboardingPendingErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-2",
      userId: "usr_offboard_1",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      actorId: "admin",
    });
    expect(receipt.revokedCredentials).toBe(2);
    expect(receipt.revokedAgents).toBe(1);
    expect(receipt.status).toBe("pending");

    const apiKey = database.prepare("SELECT revoked_at FROM user_api_keys WHERE user_id = ?").get("usr_offboard_1") as { revoked_at: string | null };
    expect(apiKey.revoked_at).toBeTruthy();
    const agent = database.prepare("SELECT deregistered_at, status FROM registered_agents WHERE id = ?").get("agt_offboard_1") as { deregistered_at: string | null; status: string };
    expect(agent.deregistered_at).toBeTruthy();
    expect(agent.status).toBe("dormant");
    expect(database.prepare("SELECT COUNT(*) AS count FROM skill_version_pins WHERE agent_id = ?").get("agt_offboard_1")).toMatchObject({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM skill_dependencies WHERE dependent_agent_id = ?").get("agt_offboard_1")).toMatchObject({ count: 0 });
  });

  it("does not claim completion until the attached subject erasure plan completed", () => {
    const database = freshDb();
    const receipt = triggerOffboardingPendingErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-3",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      actorId: "admin",
    });
    expect(receipt.status).toBe("pending");

    const attached = attachPendingPlanToReview(database, {
      tenantId: "default-tenant",
      reviewId: receipt.reviewId,
      planId: "suberase_test_plan",
      actorId: "admin",
    });
    expect(attached?.status).toBe("in_progress");
    expect(attached?.pendingPlanId).toBe("suberase_test_plan");

    expect(() => completeOffboardingReview(database, {
      tenantId: "default-tenant",
      reviewId: receipt.reviewId,
      actorId: "admin",
    })).toThrow(OffboardingReviewCompletionError);
    expect(database.prepare("SELECT status FROM memory_offboarding_reviews WHERE id = ?").get(receipt.reviewId)).toMatchObject({ status: "in_progress" });

    database.prepare(
      `INSERT INTO memory_subject_erasure_plans (
        id, tenant_id, subject_hash, scope_hash, plan_hash, source_version_hash,
        created_by, status, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
      "suberase_test_plan",
      "default-tenant",
      "subject-hash-3",
      "scope-hash",
      "plan-hash",
      "source-hash",
      "operator",
      JSON.stringify({ status: "completed" })
    );
    const completed = completeOffboardingReview(database, {
      tenantId: "default-tenant",
      reviewId: receipt.reviewId,
      actorId: "admin",
    });
    expect(completed?.status).toBe("completed");
  });
});

describe("VAL-MEM-030: tombstones preserve continuity without payload", () => {
  it("writes a non-sensitive tombstone pointer with no raw payload", () => {
    const database = freshDb();
    const tombstone = writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-1",
      canonicalId: "canon-1",
      recordType: "message",
      recordId: "msg-1",
      recordIdHash: crypto.createHash("sha256").update("msg-1").digest("hex"),
      derivativeInventory: makeDerivativeInventory(),
      policyId: "policy-dsar",
      policyVersion: "v1",
      erasureId: "erasure_1",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      outcome: "erased",
      actorId: "operator",
    });
    expect(tombstone.id).toMatch(/^tomb_/);
    expect(tombstone.subjectHash).toBe("subject-hash-tomb-1");
    expect(tombstone.policyId).toBe("policy-dsar");
    expect(tombstone.outcome).toBe("erased");

    // Tombstone contains no raw payload.
    const row = database.prepare("SELECT * FROM memory_tombstones WHERE id = ?").get(tombstone.id) as Record<string, unknown>;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("vector_projection"); // derivative reason is preserved as a label only -- this is fine
    expect(serialized).not.toContain("leaver content");
    expect(serialized).not.toContain("secret");
  });

  it("is idempotent: replay never creates a duplicate tombstone row", () => {
    const database = freshDb();
    const first = writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-2",
      canonicalId: "canon-2",
      recordType: "message",
      recordId: "msg-2",
      recordIdHash: crypto.createHash("sha256").update("msg-2").digest("hex"),
      derivativeInventory: makeDerivativeInventory(),
      policyId: "policy-dsar",
      policyVersion: "v1",
      erasureId: "erasure_2",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      outcome: "erased",
      actorId: "operator",
    });
    const second = writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-2",
      canonicalId: "canon-2",
      recordType: "message",
      recordId: "msg-2",
      recordIdHash: crypto.createHash("sha256").update("msg-2").digest("hex"),
      derivativeInventory: makeDerivativeInventory(),
      policyId: "policy-dsar",
      policyVersion: "v1",
      erasureId: "erasure_2",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      outcome: "erased",
      actorId: "operator",
    });
    expect(second.id).toBe(first.id);
    const rows = database.prepare("SELECT COUNT(*) AS count FROM memory_tombstones WHERE erasure_id = ?").get("erasure_2") as { count: number };
    expect(rows.count).toBe(1);
  });

  it("verifyTombstoneContinuity passes for matching inventory and fails for tampered inventory", () => {
    const database = freshDb();
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-3",
      canonicalId: "canon-3",
      recordType: "message",
      recordId: "msg-3",
      recordIdHash: crypto.createHash("sha256").update("msg-3").digest("hex"),
      derivativeInventory: makeDerivativeInventory(),
      policyId: "policy-dsar",
      policyVersion: "v1",
      erasureId: "erasure_3",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      outcome: "erased",
      actorId: "operator",
    });

    const matching = new Map<string, SubjectDerivativeInventory[]>();
    matching.set("canon-3:msg-3", makeDerivativeInventory());
    const okReport = verifyTombstoneContinuity(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-3",
      derivativeInventories: matching,
    });
    expect(okReport.valid).toBe(true);
    expect(okReport.tombstonesChecked).toBe(1);

    // Tamper with the inventory -- the hash should mismatch.
    const tampered = new Map<string, SubjectDerivativeInventory[]>();
    tampered.set("canon-3:msg-3", [
      { storeId: "vector", action: "purge", reason: "tampered_reason", sourceHash: "h1", provenance: "ingress" },
    ]);
    const badReport = verifyTombstoneContinuity(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-3",
      derivativeInventories: tampered,
    });
    expect(badReport.valid).toBe(false);
    expect(badReport.firstBrokenTombstoneId).toBeTruthy();
    expect(badReport.reason).toMatch(/derivative_inventory_hash mismatch/);
  });

  it("rejects invalid timestamps when writing tombstones", () => {
    const database = freshDb();
    expect(() =>
      writeTombstoneForErasure(database, {
        tenantId: "default-tenant",
        subjectHash: "subject-hash-bad-time",
        canonicalId: "canon-bad",
        recordType: "message",
        recordId: "msg-bad",
        recordIdHash: crypto.createHash("sha256").update("msg-bad").digest("hex"),
        derivativeInventory: makeDerivativeInventory(),
        erasureId: "erasure_bad",
        scope: { tenantId: "default-tenant", purpose: "recall" },
        outcome: "erased",
        actorId: "operator",
        createdAt: "not-a-date",
      })
    ).toThrow(/Invalid UTC timestamp/);
  });

  it("listTombstones returns append-only ordering", () => {
    const database = freshDb();
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-4",
      canonicalId: "canon-a",
      recordType: "message",
      recordId: "msg-a",
      recordIdHash: crypto.createHash("sha256").update("msg-a").digest("hex"),
      derivativeInventory: makeDerivativeInventory(),
      policyId: "policy-dsar",
      policyVersion: "v1",
      erasureId: "erasure_a",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      outcome: "erased",
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    writeTombstoneForErasure(database, {
      tenantId: "default-tenant",
      subjectHash: "subject-hash-tomb-4",
      canonicalId: "canon-b",
      recordType: "message",
      recordId: "msg-b",
      recordIdHash: crypto.createHash("sha256").update("msg-b").digest("hex"),
      derivativeInventory: makeDerivativeInventory(),
      policyId: "policy-dsar",
      policyVersion: "v1",
      erasureId: "erasure_b",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      outcome: "erased",
      actorId: "operator",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const tombstones = listTombstones(database, { tenantId: "default-tenant", subjectHash: "subject-hash-tomb-4" });
    expect(tombstones).toHaveLength(2);
    expect(tombstones[0]!.canonicalId).toBe("canon-a");
    expect(tombstones[1]!.canonicalId).toBe("canon-b");
  });
});
