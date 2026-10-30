// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  buildSkillAuditEntry,
  skillAuditEntryHash,
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

describe("skill-chain batch23 — stable arrays, sanitization, missing entryHash", () => {
  it("skillAuditEntryHash normalizes nested arrays in metadata", () => {
    const row = {
      id: "entry-b23",
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator" as const,
      eventType: "skill.pin.updated",
      entityType: "skill",
      entityId: "1",
      reason: null,
      metadata: { tags: ["beta", "alpha"], nested: [{ z: 1, a: 2 }] },
      createdAt: "2026-10-30T00:00:00.000Z",
    };
    const hash = skillAuditEntryHash(row);
    expect(hash).toMatch(/^sha256:/);
    expect(skillAuditEntryHash({ ...row, metadata: { tags: ["beta", "alpha"], nested: [{ a: 2, z: 1 }] } })).toBe(hash);
  });

  it("buildSkillAuditEntry rejects blank tenantId", () => {
    const database = freshDb();
    expect(() =>
      buildSkillAuditEntry(database, {
        tenantId: "   ",
        actorId: "operator",
        actorRole: "operator",
        eventType: "skill.sync.started",
        entityType: "skill",
        entityId: "1",
        metadata: {},
      }),
    ).toThrow(/tenantId is required/);
  });

  it("buildSkillAuditEntry drops long body-like metadata strings", () => {
    const database = freshDb();
    const built = buildSkillAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.sync.completed",
      entityType: "skill",
      entityId: "1",
      metadata: {
        note_body: "x".repeat(600),
        note: "short",
      },
    });
    const meta = JSON.parse(built.metadata_json) as Record<string, unknown>;
    expect(meta.note_body).toBeUndefined();
    expect(meta.note).toBe("short");
  });

  it("verifySkillAuditChain fails when entryHash is missing", () => {
    const database = freshDb();
    const id = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', 'skill.test.missing_hash', 'skill', '1', NULL, ?, ?)`,
      )
      .run(id, JSON.stringify({ previousEntryHash: null }), "2026-10-30T00:00:00.000Z");
    const result = verifySkillAuditChain(database, "default-tenant");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing entryHash");
    expect(result.firstBrokenEntryId).toBe(id);
  });

  it("verifySkillAuditChain validates a chained write", () => {
    const database = freshDb();
    writeChainedSkillAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.registry.updated",
      entityType: "skill",
      entityId: "skill-b23",
      metadata: { version: "1.0.0" },
      createdAt: "2026-10-30T00:00:00.000Z",
    });
    expect(verifySkillAuditChain(database, "default-tenant").valid).toBe(true);
  });
});
