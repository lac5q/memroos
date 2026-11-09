// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  buildSkillAuditEntry,
  verifySkillAuditChain,
  writeChainedSkillAuditEntry,
} from "../skill-chain";

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

describe("skill-chain batch17b — sanitization and verification branches", () => {
  it("buildSkillAuditEntry strips forbidden metadata keys", () => {
    const database = freshDb();
    const built = buildSkillAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.pin.updated",
      entityType: "skill_version_pin",
      entityId: "pin-1",
      metadata: {
        raw_body: "secret skill text",
        content_hash: "abc",
        note: "ok",
      },
    });
    const meta = JSON.parse(built.metadata_json) as Record<string, unknown>;
    expect(meta.raw_body).toBeUndefined();
    expect(meta.note).toBe("ok");
    expect(typeof meta.entryHash).toBe("string");
  });

  it("buildSkillAuditEntry rejects event types outside skill prefix", () => {
    const database = freshDb();
    expect(() =>
      buildSkillAuditEntry(database, {
        tenantId: "default-tenant",
        actorId: "operator",
        actorRole: "operator",
        eventType: "knowledge.access",
        entityType: "skill",
        entityId: "1",
        metadata: {},
      }),
    ).toThrow(/eventType must start with/);
  });

  it("verifySkillAuditChain detects entryHash mismatch on appended row", () => {
    const database = freshDb();
    const entityId = `prop-${crypto.randomUUID()}`;
    const firstId = writeChainedSkillAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.proposal.approved",
      entityType: "skill_import_proposal",
      entityId,
      metadata: { proposal_id: "p1" },
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    const row = database
      .prepare(`SELECT metadata_json FROM audit_entries WHERE id = ?`)
      .get(firstId) as { metadata_json: string };
    const firstMeta = JSON.parse(row.metadata_json) as Record<string, unknown>;
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', 'skill.proposal.approved', 'skill_import_proposal', ?, NULL, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        entityId,
        JSON.stringify({
          ...firstMeta,
          entryHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          previousEntryHash: firstMeta.entryHash,
        }),
        "2026-07-10T00:00:01.000Z",
      );
    const result = verifySkillAuditChain(database, "default-tenant");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/entryHash mismatch/);
  });

  it("writeChainedSkillAuditEntry links previousEntryHash across two events", () => {
    const database = freshDb();
    writeChainedSkillAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.quarantine.transitioned",
      entityType: "skill",
      entityId: "skill:1",
      metadata: { stage: "imported" },
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    const second = buildSkillAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.quarantine.transitioned",
      entityType: "skill",
      entityId: "skill:1",
      metadata: { stage: "approved" },
      createdAt: "2026-07-10T00:00:01.000Z",
    });
    const secondMeta = JSON.parse(second.metadata_json) as Record<string, unknown>;
    expect(secondMeta.previousEntryHash).toMatch(/^sha256:/);
    expect(verifySkillAuditChain(database, "default-tenant").valid).toBe(true);
  });
});
