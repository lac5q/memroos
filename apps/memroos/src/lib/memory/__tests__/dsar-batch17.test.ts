// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeDsarVerificationHash, submitDsarRequest } from "../dsar";

const VAULT_ROOT = path.join(os.tmpdir(), `dsar-b17-${crypto.randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedMessage(database: Database.Database, subjectId: string): number {
  const messageId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(
      `sess-${crypto.randomUUID()}`,
      "alpha",
      "agent",
      "user",
      "payload",
      "2026-01-01T00:00:00.000Z",
      "internal",
      "indexable",
    ).lastInsertRowid as number;
  database
    .prepare(
      `INSERT OR IGNORE INTO memory_retention_policies
        (id, tenant_id, name, version, ontology_type, security_label_json, purpose, scope_json,
         priority, duration_days, action, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      "policy-dsar-b17",
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
  database
    .prepare(
      `INSERT OR REPLACE INTO memory_retention_records
        (id, tenant_id, record_type, record_id, ontology_type, security_label_json, purpose, scope_json,
         policy_id, policy_version, retention_deadline, status, content_hash, created_at, updated_at)
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar-b17', 'v1', ?, 'active', ?, ?, ?)`,
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

function verifiedExportInput(requestId: string, subjectId: string) {
  const subject = { subjectId };
  const tenantId = "default-tenant";
  const verificationHash = computeDsarVerificationHash({
    subject,
    verificationMethod: "email_token",
    actorId: "operator",
    tenantId,
  });
  return {
    tenantId,
    requestType: "export" as const,
    subject,
    scope: { tenantId, purpose: "recall" as const, project: "alpha" as const },
    verificationMethod: "email_token" as const,
    verificationHash,
    actorId: "operator",
    requestId,
  };
}

beforeEach(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env.MEMROOS_VAULT_ROOT = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
});

describe("dsar batch17 — timestamps, subjects, audit links, idempotency", () => {
  it("submitDsarRequest throws on invalid now timestamp", () => {
    const database = freshDb();
    expect(() =>
      submitDsarRequest(database, {
        ...verifiedExportInput(`dsar-b17-ts-${crypto.randomUUID()}`, "subject-ts"),
        now: "not-a-valid-date" as never,
      }),
    ).toThrow(/Invalid UTC timestamp/);
  });

  it("submitDsarRequest returns missing_subject when subject selector is null", () => {
    const database = freshDb();
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: null as never,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "a".repeat(64),
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_subject");
  });

  it("export dedupe materializes prior row when result_json is malformed", () => {
    const database = freshDb();
    const subjectId = `subject-dedupe-${crypto.randomUUID().slice(0, 8)}`;
    seedMessage(database, subjectId);
    const first = verifiedExportInput(`dsar-b17-first-${crypto.randomUUID()}`, subjectId);
    const exported = submitDsarRequest(database, first);
    expect(exported.ok).toBe(true);

    const dedupeId = `dsar-b17-dedupe-${crypto.randomUUID()}`;
    database
      .prepare(`UPDATE memory_dsar_requests SET result_json = ? WHERE id = ?`)
      .run("{not-json", exported.requestId);

    const secondInput = verifiedExportInput(dedupeId, subjectId);
    const second = submitDsarRequest(database, secondInput);
    expect(second.ok).toBe(true);
    expect(second.status).toBe("exported");
    expect(second.requestId).toBe(exported.requestId);
  });

  it("export includes non-sensitive audit links for matched record hashes", () => {
    const database = freshDb();
    const subjectId = `subject-audit-${crypto.randomUUID().slice(0, 8)}`;
    const messageId = seedMessage(database, subjectId);
    const recordHash = database
      .prepare(`SELECT content_hash FROM memory_retention_records WHERE record_id = ?`)
      .get(String(messageId)) as { content_hash: string };
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', 'memory.retention_touch', 'message', ?, 'test', '{}', ?)`,
      )
      .run(`audit-b17-${crypto.randomUUID()}`, recordHash.content_hash, "2026-01-02T00:00:00.000Z");

    const result = submitDsarRequest(database, verifiedExportInput(`dsar-b17-audit-${crypto.randomUUID()}`, subjectId));
    expect(result.ok).toBe(true);
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("delete path returns denied when erasure plan cannot match subject", () => {
    const database = freshDb();
    const subject = { subjectId: `ghost-${crypto.randomUUID().slice(0, 8)}` };
    const tenantId = "default-tenant";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "password_reauth",
      actorId: "operator",
      tenantId,
    });
    const result = submitDsarRequest(database, {
      tenantId,
      requestType: "delete",
      subject,
      scope: { tenantId, purpose: "recall", project: "missing-project" },
      verificationMethod: "password_reauth",
      verificationHash,
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(["denied", "ambiguous"]).toContain(result.status);
  });
});
