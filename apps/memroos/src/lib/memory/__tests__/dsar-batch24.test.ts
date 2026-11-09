// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as subjectErasure from "../subject-erasure";

const VAULT_ROOT = path.join(os.tmpdir(), `dsar-b24-${randomUUID()}`);

let db: Database.Database | null = null;

function seedMessageForDsar(database: Database.Database, subjectId: string): number {
  const messageId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(
      `sess-${randomUUID()}`,
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
      "policy-dsar-b24-seed",
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
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar-b24-seed', 'v1', ?, 'active', ?, ?, ?)`,
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

describe("dsar batch24 — finalize guard and audit inventory branches", () => {
  it("finalizeRequest no-ops when memory_dsar_requests table disappears before denial finalize", async () => {
    vi.resetModules();
    vi.doMock("../subject-erasure", async (importOriginal) => {
      const actual = await importOriginal<typeof subjectErasure>();
      return {
        ...actual,
        createSubjectErasurePlan: () => ({
          ok: false,
          status: "denied",
          reason: "mock_denied_batch24",
          plan: null,
        }),
      };
    });
    const { submitDsarRequest, computeDsarVerificationHash } = await import("../dsar");
    const database = freshDb();
    const subject = { subjectId: `subject-deny-${randomUUID().slice(0, 8)}` };
    seedMessageForDsar(database, subject.subjectId!);
    const tenantId = "default-tenant";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
    });

    let dropped = false;
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (!dropped && sql.includes("INSERT INTO memory_dsar_requests")) {
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (...args: unknown[]) => {
          const result = originalRun(...args);
          database.exec("DROP TABLE memory_dsar_requests");
          dropped = true;
          return result;
        };
      }
      return stmt;
    });

    const result = submitDsarRequest(database, {
      tenantId,
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b24-deny-${randomUUID()}`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("mock_denied_batch24");
    vi.doUnmock("../subject-erasure");
  });

  it("export succeeds with zero audit link rows when no memory audit entries match", async () => {
    const { submitDsarRequest, computeDsarVerificationHash } = await import("../dsar");
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        `sess-${randomUUID()}`,
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
        "policy-dsar-b24",
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
    const subjectId = `subject-no-audit-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT OR REPLACE INTO memory_retention_records
          (id, tenant_id, record_type, record_id, ontology_type, security_label_json, purpose, scope_json,
           policy_id, policy_version, retention_deadline, status, content_hash, created_at, updated_at)
         VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar-b24', 'v1', ?, 'active', ?, ?, ?)`,
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
    const subject = { subjectId };
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b24-no-audit-${randomUUID()}`,
    });
    expect(result.ok).toBe(true);
  });
});
