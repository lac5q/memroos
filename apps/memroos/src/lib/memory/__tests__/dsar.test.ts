// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  computeDsarVerificationHash,
  executeDsarDelete,
  submitDsarRequest,
} from "../dsar";
import { sha256Hex } from "../retention-policy";

const VAULT_ROOT = path.join(os.tmpdir(), `dsar-test-${crypto.randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedMessage(database: Database.Database, subjectId: string, content = "DSAR_SECRET_PAYLOAD"): number {
  const messageId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`
    )
    .run(`sess-${subjectId}`, "alpha", "agent", "user", content, "2026-01-01T00:00:00.000Z", "internal", "indexable")
    .lastInsertRowid as number;
  database
    .prepare("INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?, 'mid', 1.0, ?)")
    .run(messageId, "2025-12-31T00:00:00.000Z");
  // Register a retention record so the subject erasure planner can resolve it.
  database
    .prepare(
      `INSERT OR IGNORE INTO memory_retention_policies
        (id, tenant_id, name, version, ontology_type, security_label_json, purpose, scope_json,
         priority, duration_days, action, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      "policy-dsar",
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
      "2026-01-01T00:00:00.000Z"
    );
  database
    .prepare(
      `INSERT OR REPLACE INTO memory_retention_records
        (id, tenant_id, record_type, record_id, ontology_type, security_label_json, purpose, scope_json,
         policy_id, policy_version, retention_deadline, status, content_hash, created_at, updated_at)
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar', 'v1', ?, 'active', ?, ?, ?)`
    )
    .run(
      `retrec_${messageId}`,
      "default-tenant",
      String(messageId),
      JSON.stringify({ visibility: "internal" }),
      JSON.stringify({ tenantId: "default-tenant", purpose: "recall", project: "alpha", subjectId }),
      "2026-12-31T00:00:00.000Z",
      `hash-${messageId}`,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );
  return messageId;
}

beforeEach(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env["MEMROOS_VAULT_ROOT"] = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env["MEMROOS_VAULT_ROOT"];
});

describe("VAL-MEM-027: DSAR export/delete is identity-verified and complete", () => {
  it("denies export with mismatched verification hash (no mutation)", () => {
    const database = freshDb();
    seedMessage(database, "subject-deny");
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-deny" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash: "deadbeef".repeat(8),
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("identity_verification_failed");
    expect(result.manifestHash).toBeNull();
    // The denial row IS persisted so the audit chain captures the failed verification
    // attempt; downstream retries are observable through the same row.
    const denialRow = database.prepare("SELECT status, denial_reason FROM memory_dsar_requests WHERE id = ?").get(result.requestId) as { status: string; denial_reason: string };
    expect(denialRow.status).toBe("denied");
    expect(denialRow.denial_reason).toBe("identity_verification_failed");
  });

  it("export produces a manifest with manifest_hash + manifest_artifact_id (no raw payload)", () => {
    const database = freshDb();
    seedMessage(database, "subject-export", "DSAR_EXPORT_PAYLOAD");
    const subjectHash = computeDsarVerificationHash({
      subject: { subjectId: "subject-export" },
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    }).slice(0, 0); // we'll re-derive
    const verificationHash = computeDsarVerificationHash({
      subject: { subjectId: "subject-export" },
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    void subjectHash;
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-export" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
    });
    // Subject matches a retention record now, so the export should succeed.
    expect(result.ok).toBe(true);
    expect(result.status).toBe("exported");
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifestArtifactId).toBeTruthy();
    const requestRow = database.prepare("SELECT * FROM memory_dsar_requests WHERE id = ?").get(result.requestId) as Record<string, unknown>;
    const serialized = JSON.stringify(requestRow);
    expect(serialized).not.toContain("DSAR_EXPORT_PAYLOAD");
  });

  it("idempotent export returns the same manifest_hash on duplicate request", () => {
    const database = freshDb();
    seedMessage(database, "subject-idem");
    const verificationHash = computeDsarVerificationHash({
      subject: { subjectId: "subject-idem" },
      verificationMethod: "oauth_subject",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const first = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-idem" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "oauth_subject",
      verificationHash,
      actorId: "operator",
    });
    const second = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-idem" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "oauth_subject",
      verificationHash,
      actorId: "operator",
    });
    expect(first.status).toBe("exported");
    expect(second.status).toBe("exported");
    expect(first.manifestHash).toBe(second.manifestHash);
    const requests = database.prepare("SELECT COUNT(*) AS count FROM memory_dsar_requests WHERE status = 'exported'").get() as { count: number };
    expect(requests.count).toBe(1);
  });

  it("delete creates a plan; executeDsarDelete runs the coordinator and writes tombstones", async () => {
    const database = freshDb();
    seedMessage(database, "subject-delete", "DSAR_DELETE_PAYLOAD");
    const verificationHash = computeDsarVerificationHash({
      subject: { subjectId: "subject-delete" },
      verificationMethod: "signed_assertion",
      actorId: "reviewer",
      tenantId: "default-tenant",
    });
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "delete",
      subject: { subjectId: "subject-delete" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "signed_assertion",
      verificationHash,
      actorId: "reviewer",
    });
    expect(result.ok).toBe(true);
    expect(result.planId).toBeTruthy();

    const execution = await executeDsarDelete(database, {
      tenantId: "default-tenant",
      requestId: result.requestId,
      planHash: result.plan!.planHash,
      actorId: "operator",
    });
    expect(execution.ok).toBe(true);
    expect(execution.status).toBe("deleted");

    // Original message content has been erased.
    const msg = database.prepare("SELECT content FROM messages").get() as { content: string };
    expect(msg.content).toBe("[erased]");

    // Tombstone written.
    const tombstones = database.prepare("SELECT COUNT(*) AS count FROM memory_erasure_tombstones").get() as { count: number };
    expect(tombstones.count).toBeGreaterThan(0);
  });

  it("rejects unsupported verification methods", () => {
    const database = freshDb();
    seedMessage(database, "subject-method");
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-method" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "magic_link" as never,
      verificationHash: "abc".padEnd(64, "0"),
      actorId: "operator",
    });
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("unsupported_verification_method");
  });

  it("rejects malformed verification hash (not 64 hex chars)", () => {
    const database = freshDb();
    seedMessage(database, "subject-hash");
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-hash" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash: "not-hex",
      actorId: "operator",
    });
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("identity_verification_failed");
  });

  it("rejects missing subject identity (denied)", () => {
    const database = freshDb();
    seedMessage(database, "subject-no-id");
    const verificationHash = computeDsarVerificationHash({
      subject: { name: "Only Name" },
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { name: "Only Name" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
    });
    // Only a name was provided -- DSAR requires an exact identifier (subjectId, userId, etc).
    // Names alone are not enough for identity verification because the planner only
    // matches on exact fields.
    expect(result.ok).toBe(false);
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("missing_subject_identity");
  });

  it("executeDsarDelete fails closed for missing, non-delete, and planless requests", async () => {
    const database = freshDb();
    const missing = await executeDsarDelete(database, {
      tenantId: "default-tenant",
      requestId: "dsar_missing",
      planHash: "abc",
      actorId: "operator",
    });
    expect(missing.status).toBe("failed");
    expect(missing.reason).toBe("dsar_request_not_found");

    seedMessage(database, "export-only");
    const verificationHash = computeDsarVerificationHash({
      subject: { subjectId: "export-only" },
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const exported = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "export-only" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
    });
    expect(exported.status).toBe("exported");
    const wrongType = await executeDsarDelete(database, {
      tenantId: "default-tenant",
      requestId: exported.requestId,
      planHash: "abc",
      actorId: "operator",
    });
    expect(wrongType.reason).toBe("dsar_request_not_delete");

    database
      .prepare(
        `INSERT INTO memory_dsar_requests
          (id, tenant_id, request_type, subject_hash, selector_hashes_json, verification_method,
           verification_hash, scope_json, scope_hash, status, result_json, created_by, created_at)
         VALUES (?, ?, 'delete', ?, '{}', 'email_token', ?, '{}', ?, 'verified', '{}', ?, ?)`
      )
      .run(
        "dsar_no_plan",
        "default-tenant",
        sha256Hex("subject"),
        verificationHash,
        "scope-hash",
        "operator",
        "2026-01-01T00:00:00.000Z"
      );
    const noPlan = await executeDsarDelete(database, {
      tenantId: "default-tenant",
      requestId: "dsar_no_plan",
      planHash: "abc",
      actorId: "operator",
    });
    expect(noPlan.reason).toBe("dsar_plan_missing");
  });

  it("rejects missing scope tenant", () => {
    const database = freshDb();
    seedMessage(database, "subject-tenant");
    const verificationHash = computeDsarVerificationHash({
      subject: { subjectId: "subject-tenant" },
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-tenant" },
      scope: { tenantId: "", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
    });
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("missing_tenant");
  });

  it("rejects missing scope purpose", () => {
    const database = freshDb();
    seedMessage(database, "subject-scope");
    const verificationHash = computeDsarVerificationHash({
      subject: { subjectId: "subject-scope" },
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-scope" },
      scope: { tenantId: "default-tenant" } as never,
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("denied");
    expect(result.reason).toBe("missing_purpose");
  });
});
