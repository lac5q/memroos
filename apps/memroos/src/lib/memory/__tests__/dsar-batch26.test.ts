// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeDsarVerificationHash, submitDsarRequest } from "../dsar";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedPolicy(database: Database.Database): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO memory_retention_policies
        (id, tenant_id, name, version, ontology_type, security_label_json, purpose, scope_json,
         priority, duration_days, action, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      "policy-dsar-b26",
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
}

function seedMessageForDsar(database: Database.Database, subjectId: string): number {
  const messageId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "payload", "2026-01-01T00:00:00.000Z", "internal", "indexable")
    .lastInsertRowid as number;
  seedPolicy(database);
  database
    .prepare(
      `INSERT OR REPLACE INTO memory_retention_records
        (id, tenant_id, record_type, record_id, ontology_type, security_label_json, purpose, scope_json,
         policy_id, policy_version, retention_deadline, status, content_hash, created_at, updated_at)
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar-b26', 'v1', ?, 'active', ?, ?, ?)`,
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
      "2026-01-01T00:00:00.000Z",
    );
  return messageId;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("dsar batch26 — verification edges and duplicate replay", () => {
  it("submitDsarRequest rejects unsupported verification methods before insert", () => {
    const database = freshDb();
    const subjectId = `subject-method-b26-${randomUUID().slice(0, 6)}`;
    seedMessageForDsar(database, subjectId);
    const subject = { subjectId };
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
      verificationMethod: "operator_attestation" as "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b26-method-${randomUUID()}`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_verification_method");
  });

  it("submitDsarRequest replays completed export for duplicate request id", () => {
    const database = freshDb();
    const subjectId = `subject-replay-b26-${randomUUID().slice(0, 6)}`;
    seedMessageForDsar(database, subjectId);
    const subject = { subjectId };
    const tenantId = "default-tenant";
    const requestId = `dsar-b26-replay-${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
    });
    const scope = { tenantId, purpose: "recall", project: "alpha" };
    const first = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId,
    });
    expect(first.ok).toBe(true);
    const second = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId,
    });
    expect(second.ok).toBe(true);
    expect(second.manifestHash).toBe(first.manifestHash);
  });

  it("materializeExisting treats malformed result_json as empty without throwing", () => {
    const database = freshDb();
    const subjectId = `subject-badjson-b26-${randomUUID().slice(0, 6)}`;
    seedMessageForDsar(database, subjectId);
    const subject = { subjectId };
    const tenantId = "default-tenant";
    const requestId = `dsar-b26-badjson-${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
    });
    const first = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId,
    });
    expect(first.ok).toBe(true);

    database
      .prepare(`UPDATE memory_dsar_requests SET result_json = ? WHERE id = ?`)
      .run("{not-json", requestId);

    const replay = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId,
    });
    expect(replay.ok).toBe(true);
    expect(replay.requestId).toBe(requestId);
  });
});
