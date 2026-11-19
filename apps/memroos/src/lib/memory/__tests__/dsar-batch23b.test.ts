// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const VAULT_ROOT = path.join(os.tmpdir(), `dsar-b23b-${crypto.randomUUID()}`);

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
    .run(`sess-${crypto.randomUUID()}`, "alpha", "agent", "user", "payload", "2026-01-01T00:00:00.000Z", "internal", "indexable")
    .lastInsertRowid as number;
  database
    .prepare(
      `INSERT OR IGNORE INTO memory_retention_policies
        (id, tenant_id, name, version, ontology_type, security_label_json, purpose, scope_json,
         priority, duration_days, action, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      "policy-dsar-b23b",
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
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar-b23b', 'v1', ?, 'active', ?, ?, ?)`,
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
  vi.resetModules();
});

describe("dsar batch23b — audit inventory mapping", () => {
  it("export maps audit link rows when entity_id matches retention record hash", async () => {
    const { computeDsarVerificationHash, submitDsarRequest } = await import("../dsar");
    const database = freshDb();
    const subjectId = `subject-links-b23b-${crypto.randomUUID().slice(0, 8)}`;
    const messageId = seedMessage(database, subjectId);
    const recordHash = database
      .prepare(`SELECT content_hash FROM memory_retention_records WHERE record_id = ?`)
      .get(String(messageId)) as { content_hash: string };
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', 'memory.retention_touch', 'message', ?, 'batch23b', '{}', ?)`,
      )
      .run(`audit-b23b-${crypto.randomUUID()}`, recordHash.content_hash, "2026-01-02T00:00:00.000Z");
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
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      requestId: `dsar-b23b-links-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(true);
  });
});
