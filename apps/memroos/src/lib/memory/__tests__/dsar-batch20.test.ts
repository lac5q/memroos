// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const VAULT_ROOT = path.join(os.tmpdir(), `dsar-b20-${crypto.randomUUID()}`);

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
      "policy-dsar-b20",
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
       VALUES (?, ?, 'message', ?, 'memory.contact_event', ?, 'recall', ?, 'policy-dsar-b20', 'v1', ?, 'active', ?, ?, ?)`,
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
  vi.doUnmock("../vault-durability");
  vi.resetModules();
});

describe("dsar batch20 — manifest write failure and audit link inventory", () => {
  it("export fails closed when vault manifest write throws", async () => {
    vi.doMock("../vault-durability", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../vault-durability")>();
      return {
        ...actual,
        writeVaultArtifactWithDurability: () => {
          throw new Error("vault_disk_full");
        },
      };
    });
    const { computeDsarVerificationHash, submitDsarRequest } = await import("../dsar");
    const database = freshDb();
    const subjectId = `subject-vault-fail-${crypto.randomUUID().slice(0, 8)}`;
    seedMessage(database, subjectId);
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
      requestId: `dsar-b20-fail-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/manifest_write_failed:vault_disk_full/);
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("export includes audit link inventory when matching audit rows exist", async () => {
    const { computeDsarVerificationHash, submitDsarRequest } = await import("../dsar");
    const database = freshDb();
    const subjectId = `subject-audit-b20-${crypto.randomUUID().slice(0, 8)}`;
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
      .run(`audit-b20-${crypto.randomUUID()}`, recordHash.content_hash, "2026-01-02T00:00:00.000Z");
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
      requestId: `dsar-b20-audit-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(true);
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
