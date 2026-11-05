// @vitest-environment node
import crypto from "crypto";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import {
  approveSubjectErasurePlan,
  createSubjectErasurePlan,
  executeSubjectErasurePlan,
  listSubjectErasurePlans,
} from "../subject-erasure";
import * as erasureModule from "../erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-${crypto.randomUUID()}`,
    name: "subject batch11",
    ontologyType: "*",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 365,
    priority: 1,
    actorId: "operator",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return db;
}

function seedMessage(
  database: Database.Database,
  content: string,
  subjectId: string,
  scopeExtras: Record<string, unknown> = {}
): number {
  const messageId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`
    )
    .run(
      `sess-${crypto.randomUUID()}`,
      "alpha",
      "agent",
      "user",
      content,
      "2026-01-01T00:00:00.000Z",
      "internal",
      "indexable"
    ).lastInsertRowid as number;
  registerRetentionRecord(database, {
    recordType: "message",
    recordId: String(messageId),
    ontologyType: "memory.contact_event",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: {
      tenantId: "default-tenant",
      purpose: "recall",
      project: "alpha",
      subjectId,
      ...scopeExtras,
    },
    contentHash: `hash-${messageId}`,
    actorId: "operator",
    createdAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return messageId;
}

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("subject erasure batch11", () => {
  it("rejects planning when scope tenantId is blank", () => {
    const database = freshDb();
    seedMessage(database, "tenant missing", "subject-tenant");
    const result = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-tenant" },
      scope: { tenantId: "   ", purpose: "recall", project: "alpha" },
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_tenant");
  });

  it("filters scoped records using array and wildcard scope keys", () => {
    const database = freshDb();
    seedMessage(database, "project beta payload", "subject-scope", { project: "beta" });
    seedMessage(database, "project alpha payload", "subject-scope", { project: "alpha" });

    const arrayScope = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-scope" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: ["alpha", "beta"] },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(arrayScope.ok).toBe(true);
    expect(arrayScope.plan?.matchedRecords).toHaveLength(2);

    const wildcard = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-scope" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "*" },
      actorId: "operator",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(wildcard.ok).toBe(true);
    expect(wildcard.plan?.matchedRecords.length).toBeGreaterThanOrEqual(2);
  });

  it("includes candidate, vault, and federation coverage in derivative inventory", () => {
    const database = freshDb();
    const captureId = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess', 'ch', '2026-01-01T00:00:00Z')`
      )
      .run(captureId);
    const candidateId = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent', 'lesson', 'candidate body', ?, 'candidate', '{}', '2026-01-01T00:00:00Z')`
      )
      .run(candidateId, captureId, crypto.randomUUID());
    registerRetentionRecord(database, {
      recordType: "agent_memory_candidate",
      recordId: candidateId,
      ontologyType: "memory.lesson",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        subjectId: "subject-candidate",
        sessionId: "sess-vault",
      },
      contentHash: crypto.randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    database
      .prepare(
        `INSERT INTO raw_artifacts
         (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash, source_id, session_id)
         VALUES (?, 'default-tenant', 'memory.test', 'vault://x', 'x.bin', ?, ?, 'sess-vault')`
      )
      .run(`art-${candidateId}`, crypto.randomUUID(), candidateId);
    database
      .prepare(
        `INSERT INTO federation_action_artifacts
         (id, tenant_id, space_id, federation_run_id, pack_hash, pack_bytes, pack_item_count,
          bound_status, scope_hash, policy_hash, ontology_hash, artifact_hash)
         VALUES (?, 'default-tenant', 'space-1', 'run-1', 'ph', 1, 1, 'bounded', 'sh', 'ph2', 'oh', 'ah')`
      )
      .run(`fed-${candidateId}`);
    database
      .prepare(
        `INSERT INTO federation_action_derivatives
         (id, tenant_id, artifact_id, canonical_id, canonical_hash, source_id, status)
         VALUES (?, 'default-tenant', ?, ?, ?, ?, 'active')`
      )
      .run(`deriv-${candidateId}`, `fed-${candidateId}`, `canon-${candidateId}`, crypto.randomUUID(), candidateId);

    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-candidate" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    const storeIds = plan.plan?.coverage.map((c) => c.storeId) ?? [];
    expect(storeIds).toEqual(expect.arrayContaining(["candidates", "vault", "federation"]));
    expect((plan.plan?.excludedRecords ?? []).length).toBeGreaterThanOrEqual(0);
  });

  it("approveSubjectErasurePlan throws on invalid timestamps", () => {
    const database = freshDb();
    seedMessage(database, "bad ts", "subject-bad-ts");
    const plan = createSubjectErasurePlan(database, {
      id: "plan-bad-ts",
      subject: { subjectId: "subject-bad-ts" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(() =>
      approveSubjectErasurePlan(database, {
        planId: "plan-bad-ts",
        planHash: plan.plan!.planHash,
        actorId: "reviewer",
        now: new Date("not-a-date"),
      })
    ).toThrow(/Invalid UTC timestamp/);
  });

  it("loadPlanRow surfaces not found for unknown plan ids", () => {
    const database = freshDb();
    expect(() =>
      approveSubjectErasurePlan(database, {
        planId: "missing-plan",
        planHash: "0".repeat(64),
        actorId: "reviewer",
      })
    ).toThrow(/subject erasure plan not found/);
  });

  it("executeSubjectErasurePlan records coordinator failures without aborting the plan commit", async () => {
    const database = freshDb();
    seedMessage(database, "COORD_FAIL_SECRET", "subject-coord-fail");
    const plan = createSubjectErasurePlan(database, {
      id: "plan-coord-fail",
      subject: { subjectId: "subject-coord-fail" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    approveSubjectErasurePlan(database, {
      planId: "plan-coord-fail",
      planHash: plan.plan!.planHash,
      actorId: "reviewer",
      now: new Date("2026-01-02T00:10:00.000Z"),
    });

    vi.spyOn(erasureModule, "coordinateErasure").mockRejectedValueOnce(new Error("coordinator exploded"));

    const execution = await executeSubjectErasurePlan(database, {
      planId: "plan-coord-fail",
      planHash: plan.plan!.planHash,
      actorId: "operator",
      now: new Date("2026-01-02T00:20:00.000Z"),
    });
    expect(execution.status).toBe("failed");
    expect(execution.failed).toBe(1);
    expect(execution.storeOutcomes[0]?.outcomes[0]?.reason).toContain("coordinator exploded");

    const listed = listSubjectErasurePlans(database, { tenantId: "default-tenant", limit: 10 });
    const row = listed.find((r) => r.id === "plan-coord-fail");
    expect(row?.result).toMatchObject({ status: "failed", failed: 1 });
  });

  it("listSubjectErasurePlans parses result_json after successful execution", async () => {
    const database = freshDb();
    seedMessage(database, "LIST_RESULT_SECRET", "subject-list-result");
    const plan = createSubjectErasurePlan(database, {
      id: "plan-list-result",
      subject: { subjectId: "subject-list-result" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    approveSubjectErasurePlan(database, {
      planId: "plan-list-result",
      planHash: plan.plan!.planHash,
      actorId: "reviewer",
    });
    await executeSubjectErasurePlan(database, {
      planId: "plan-list-result",
      planHash: plan.plan!.planHash,
      actorId: "operator",
      now: new Date("2026-01-02T00:15:00.000Z"),
    });
    const rows = listSubjectErasurePlans(database, { tenantId: "default-tenant" });
    const stored = rows.find((r) => r.id === "plan-list-result");
    expect(stored?.result).toMatchObject({ status: "completed", erased: 1 });
  });
});
