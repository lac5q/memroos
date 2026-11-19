// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { countEscalations, queryAuditEntries, queryEscalations, streamAuditEntries } from "@/lib/audit/query";
import { writeAuditEntry } from "@/lib/audit/write";
import {
  buildSkillAuditEntry,
  skillAuditEntryHash,
  verifySkillAuditChain,
  writeChainedSkillAuditEntry,
} from "@/lib/audit/skill-chain";
import { initSchema } from "@/lib/db-schema";

function seedAuditDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  const now = "2026-01-15T12:00:00Z";
  writeAuditEntry(
    {
      tenant_id: "default-tenant",
      actor_id: "operator",
      actor_role: "operator",
      event_type: "test.event",
      entity_type: "user",
      entity_id: "user:alice",
      metadata_json: JSON.stringify({ userId: "alice%wild" }),
      created_at: now,
    },
    db,
  );
  writeAuditEntry(
    {
      tenant_id: "default-tenant",
      actor_id: "operator",
      actor_role: "operator",
      event_type: "test.event",
      entity_type: "user",
      entity_id: "user:bob",
      metadata_json: JSON.stringify({ user_id: "bob" }),
      created_at: "2026-01-14T12:00:00Z",
    },
    db,
  );
  db.prepare(
    `INSERT INTO hil_escalations (
       id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline,
       status, opened_by, created_at
     ) VALUES (?, 'default-tenant', 'task', 'task-1', 'agent_escalate', 3600, ?, 'open', 'operator', ?)`,
  ).run(`hil-${crypto.randomUUID()}`, "2020-01-01T00:00:00Z", now);
  return db;
}

describe("audit batch14b — query + skill chain edges", () => {
  it("queryAuditEntries filters by userId metadata and actorId", () => {
    const db = seedAuditDb();
    writeAuditEntry(
      {
        tenant_id: "default-tenant",
        actor_id: "actor-filter-me",
        actor_role: "operator",
        event_type: "test.event",
        entity_type: "user",
        entity_id: "user:actor",
        metadata_json: JSON.stringify({ userId: "alice%wild" }),
        created_at: "2026-01-13T12:00:00Z",
      },
      db,
    );
    const bob = queryAuditEntries({ userId: "bob", limit: 10 }, db);
    expect(bob.entries).toHaveLength(1);
    const actor = queryAuditEntries({ actorId: "actor-filter-me", limit: 10 }, db);
    expect(actor.entries).toHaveLength(1);
    const noMatch = queryAuditEntries({ userId: "not-present", limit: 10 }, db);
    expect(noMatch.entries).toHaveLength(0);
    db.close();
  });

  it("queryAuditEntries paginates with cursor", () => {
    const db = seedAuditDb();
    const page1 = queryAuditEntries({ limit: 1 }, db);
    expect(page1.entries).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = queryAuditEntries({ limit: 1, cursor: page1.nextCursor }, db);
    expect(page2.entries[0]?.created_at).not.toBe(page1.entries[0]?.created_at);
    db.close();
  });

  it("streamAuditEntries yields same filter semantics without buffering helper", () => {
    const db = seedAuditDb();
    const streamed = [...streamAuditEntries({ tenantId: "default-tenant" }, db)];
    expect(streamed.length).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it("queryEscalations marks overdue open items and countEscalations matches", () => {
    const db = seedAuditDb();
    const rows = queryEscalations({ status: "open", tenantId: "default-tenant" }, db);
    expect(rows[0]?.isOverdue).toBe(true);
    expect(countEscalations({ status: "open", tenantId: "default-tenant" }, db)).toBe(rows.length);
    db.close();
  });

  it("buildSkillAuditEntry redacts forbidden metadata keys", () => {
    const db = seedAuditDb();
    const built = buildSkillAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.pin.updated",
      entityType: "skill",
      entityId: "skill:1",
      metadata: { secret: "shh", skillId: "1", raw_body: "x".repeat(600) },
    });
    const meta = JSON.parse(built.metadata_json) as Record<string, unknown>;
    expect(meta.secret).toBeUndefined();
    expect(meta.raw_body).toBeUndefined();
    expect(meta.entryHash).toMatch(/^sha256:/);
    db.close();
  });

  it("writeChainedSkillAuditEntry links previousEntryHash across inserts", () => {
    const db = seedAuditDb();
    const firstId = writeChainedSkillAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.sync.started",
      entityType: "skill",
      entityId: "skill:a",
      metadata: { skillId: "a" },
      createdAt: "2026-01-01T00:00:00Z",
    });
    const secondId = writeChainedSkillAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "skill.sync.completed",
      entityType: "skill",
      entityId: "skill:a",
      metadata: { skillId: "a" },
      createdAt: "2026-01-01T00:00:01Z",
    });
    expect(firstId).not.toBe(secondId);
    const verification = verifySkillAuditChain(db, "default-tenant");
    expect(verification.valid).toBe(true);
    expect(verification.checked).toBe(2);
    db.close();
  });

  it("skillAuditEntryHash is stable for identical rows", () => {
    const row = {
      id: "id-1",
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator" as const,
      eventType: "skill.quarantine.opened",
      entityType: "skill",
      entityId: "skill:9",
      reason: null,
      metadata: { schemaVersion: 1, previousEntryHash: null },
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(skillAuditEntryHash(row)).toBe(skillAuditEntryHash(row));
  });

  it("buildSkillAuditEntry rejects non-skill event types", () => {
    const db = seedAuditDb();
    expect(() =>
      buildSkillAuditEntry(db, {
        tenantId: "default-tenant",
        actorId: "operator",
        actorRole: "operator",
        eventType: "memory.write",
        entityType: "skill",
        entityId: "skill:1",
        metadata: {},
      }),
    ).toThrow(/eventType must start with/);
    db.close();
  });
});
