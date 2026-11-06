// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import type { SubjectPlanEvidence } from "../subject-erasure";

const VAULT_ROOT = path.join(os.tmpdir(), `dsar-b29-${randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

beforeEach(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env.MEMROOS_VAULT_ROOT = VAULT_ROOT;
  vi.resetModules();
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Minimal plan evidence so performExport runs with zero matched hashes (hits queryNonSensitiveAuditLinks line 760). */
function emptyMatchedEvidence(createdAt: string): SubjectPlanEvidence & { id: string } {
  return {
    id: `plan-b29-${randomUUID()}`,
    tenantId: "default-tenant",
    subjectHash: "sub",
    selectorHashes: { subjectId: "x" },
    scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
    scopeHash: "scope",
    status: "planned",
    reason: "subject_resolved",
    matchedRecords: [],
    excludedRecords: [],
    candidates: [],
    holds: [],
    coverage: [],
    policy: { requiredReview: true, executionRequiresCurrentHash: true, rawPayloadExcluded: true },
    estimatedEffects: { targetCount: 0, heldCount: 0, purgeCount: 0, tombstoneCount: 0, zeroMatchCount: 0 },
    sourceVersionHash: "src",
    planHash: "planhash",
    createdAt,
  };
}

function seedRetentionMessageForHash(database: Database.Database): string {
  const msgId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "x", "2026-01-01T00:00:00.000Z", "internal", "indexable")
    .lastInsertRowid as number;
  const policyId = `policy-b29-${randomUUID().slice(0, 8)}`;
  database
    .prepare(
      `INSERT OR IGNORE INTO memory_retention_policies
        (id, tenant_id, name, version, ontology_type, security_label_json, purpose, scope_json,
         priority, duration_days, action, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      policyId,
      "default-tenant",
      "dsar policy",
      "v1",
      "memory.contact_event",
      JSON.stringify({ visibility: "internal" }),
      "recall",
      JSON.stringify({ tenantId: "default-tenant", project: "alpha" }),
      1,
      365,
      "expire",
      "operator",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  const contentHash = `hash-b29-${randomUUID().slice(0, 16)}`;
  database
    .prepare(
      `INSERT OR REPLACE INTO memory_retention_records
        (id, tenant_id, record_type, record_id, ontology_type, security_label_json, purpose, scope_json,
         policy_id, policy_version, retention_deadline, status, content_hash, created_at, updated_at)
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, ?, 'v1', ?, 'active', ?, ?, ?)`,
    )
    .run(
      `retrec_${msgId}`,
      "default-tenant",
      String(msgId),
      JSON.stringify({ visibility: "internal" }),
      JSON.stringify({ tenantId: "default-tenant", purpose: "recall", project: "alpha", subjectId: "sync" }),
      policyId,
      "2026-12-31T00:00:00.000Z",
      contentHash,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  return contentHash;
}

describe("dsar batch29 — queryNonSensitiveAuditLinks branches (760, 761, 771)", () => {
  it("performExport with empty record hashes skips audit query (line 760)", async () => {
    vi.doMock("@/lib/audit/memory-chain", () => ({
      writeChainedMemoryAuditEntry: () => `audit-chain-b29-${randomUUID()}`,
    }));
    vi.doMock("../subject-erasure", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../subject-erasure")>();
      const createdAt = "2026-01-01T00:00:00.000Z";
      return {
        ...actual,
        createSubjectErasurePlan: () => ({
          ok: true,
          status: "planned",
          reason: "subject_resolved",
          plan: emptyMatchedEvidence(createdAt),
          candidates: [],
        }),
      };
    });
    const { computeDsarVerificationHash, submitDsarRequest } = await import("../dsar");
    const database = freshDb();
    const subject = { subjectId: `sub-empty-b29-${randomUUID().slice(0, 8)}` };
    const tenantId = "default-tenant";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
    });
    const prepareSpy = vi.spyOn(database, "prepare");
    const result = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b29-empty-hash-${randomUUID()}`,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    const auditLinkQueries = prepareSpy.mock.calls.filter(
      (call) => String(call[0]).includes("FROM audit_entries") && String(call[0]).includes("entity_id IN"),
    );
    expect(auditLinkQueries.length).toBe(0);
  });

  it("export succeeds when audit_entries table is missing (line 761)", async () => {
    vi.doMock("@/lib/audit/memory-chain", () => ({
      writeChainedMemoryAuditEntry: vi.fn(() => `audit-chain-skip-${randomUUID()}`),
    }));
    vi.doMock("../subject-erasure", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../subject-erasure")>();
      const createdAt = "2026-01-02T00:00:00.000Z";
      const recordIdHash = `hash-b29-${randomUUID().slice(0, 8)}`;
      return {
        ...actual,
        createSubjectErasurePlan: () => ({
          ok: true,
          status: "planned",
          reason: "subject_resolved",
          plan: {
            ...emptyMatchedEvidence(createdAt),
            matchedRecords: [
              {
                canonicalId: "c1",
                canonicalHash: "ch",
                recordType: "message",
                recordId: "1",
                recordIdHash,
                ontologyType: "memory.contact_event",
                tier: "standard",
                linkReasons: [],
                derivatives: [{ storeId: "message", action: "purge" as const, reason: "test" }],
                held: false,
                holdIds: [],
                policy: { policyId: null, policyVersion: null, retentionDeadline: null, retentionStatus: "active" },
              },
            ],
          },
          candidates: [],
        }),
      };
    });
    const { computeDsarVerificationHash, submitDsarRequest } = await import("../dsar");
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const subject = { subjectId: `sub-no-audit-b29-${randomUUID().slice(0, 8)}` };
    const tenantId = "default-tenant";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
    });
    const result = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b29-no-audit-${randomUUID()}`,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
  });

  it("export queries audit_entries and maps rows for memory.* events (line 771)", async () => {
    const database = freshDb();
    const recordIdHash = seedRetentionMessageForHash(database);
    const auditAt = "2026-01-03T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'op', 'operator', 'memory.retention_touch', 'message', ?, 'batch29', '{}', ?)`,
      )
      .run(`audit-b29-${randomUUID()}`, recordIdHash, auditAt);

    const planCreatedAt = "2026-01-03T00:00:00.000Z";
    vi.doMock("../subject-erasure", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../subject-erasure")>();
      return {
        ...actual,
        createSubjectErasurePlan: () => ({
          ok: true,
          status: "planned",
          reason: "subject_resolved",
          plan: {
            ...emptyMatchedEvidence(planCreatedAt),
            matchedRecords: [
              {
                canonicalId: "c2",
                canonicalHash: "ch2",
                recordType: "message",
                recordId: "2",
                recordIdHash,
                ontologyType: "memory.contact_event",
                tier: "standard",
                linkReasons: [],
                derivatives: [],
                held: false,
                holdIds: [],
                policy: { policyId: null, policyVersion: null, retentionDeadline: null, retentionStatus: "active" },
              },
            ],
          },
          candidates: [],
        }),
      };
    });
    const { computeDsarVerificationHash, submitDsarRequest } = await import("../dsar");

    const subject = { subjectId: `sub-audit-b29-${randomUUID().slice(0, 8)}` };
    const tenantId = "default-tenant";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
    });
    const prepareSpy = vi.spyOn(database, "prepare");
    const result = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b29-audit-map-${randomUUID()}`,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    const auditSelect = prepareSpy.mock.calls.some(
      (call) => String(call[0]).includes("FROM audit_entries") && String(call[0]).includes("memory.%"),
    );
    expect(auditSelect).toBe(true);
  });
});
