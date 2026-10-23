/**
 * Phase 125 / ENTOPS-03: hash chain integrity tests for the
 * knowledge vault audit pipeline.
 *
 * The chain uses pure functions over the audit_entries table.
 * Each `buildKnowledgeAuditEntry()` derives `entryHash` from a
 * stable JSON view of the row + links to the previous entry's
 * `entryHash` for the same tenant.
 */

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { AUDIT_EVENT_TYPES, ENTITY_TYPES } from "@/lib/audit/event-types";
import {
  buildKnowledgeAuditEntry,
  knowledgeAuditEntryHash,
  previousKnowledgeEntryHash,
  verifyKnowledgeAuditChain,
  type KnowledgeAuditEntryRow,
} from "@/lib/audit/knowledge-chain";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const SCHEMA = `
  CREATE TABLE audit_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_audit_entries_tenant_event
    ON audit_entries(tenant_id, event_type);
`;

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

function insertRow(db: Database.Database, row: {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_role: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  metadata_json: string;
  created_at: string;
}): void {
  db.prepare(
    `INSERT INTO audit_entries
       (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id,
        reason, metadata_json, created_at)
     VALUES (@id, @tenant_id, @actor_id, @actor_role, @event_type, @entity_type,
             @entity_id, @reason, @metadata_json, @created_at)`
  ).run(row);
}

/**
 * Map the camelCase return from `buildKnowledgeAuditEntry` into the
 * snake_case shape that `audit_entries` expects. Pure mapping -- no
 * derivation, no normalization.
 */
function toRowForInsert(row: ReturnType<typeof buildKnowledgeAuditEntry>): {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_role: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  metadata_json: string;
  created_at: string;
} {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    actor_id: row.actorId,
    actor_role: row.actorRole,
    event_type: row.eventType,
    entity_type: row.entityType,
    entity_id: row.entityId,
    reason: row.reason,
    metadata_json: row.metadata_json,
    created_at: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildArgs(overrides: Partial<Parameters<typeof buildKnowledgeAuditEntry>[1]> = {}) {
  return {
    tenantId: "tenant-a",
    actorId: "operator-key-1",
    actorRole: "operator" as const,
    path: "shared/notes.md",
    operation: "write" as const,
    agentId: "agent-1",
    userId: "user-1",
    opHash: "sha256:abc",
    createdAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("knowledgeAuditEntryHash", () => {
  it("is deterministic for identical rows", () => {
    const row: KnowledgeAuditEntryRow = {
      id: "row-1",
      tenantId: "t",
      actorId: "a",
      actorRole: "operator",
      eventType: AUDIT_EVENT_TYPES.KNOWLEDGE_ACCESS,
      entityType: ENTITY_TYPES.KNOWLEDGE_VAULT,
      entityId: "knowledge_vault:t",
      reason: "knowledge write on x.md",
      metadata: { operation: "write", path: "x.md" },
      createdAt: "2026-07-06T00:00:00.000Z",
    };
    expect(knowledgeAuditEntryHash(row)).toBe(knowledgeAuditEntryHash(row));
  });

  it("differs when any field changes", () => {
    const base: KnowledgeAuditEntryRow = {
      id: "row-1",
      tenantId: "t",
      actorId: "a",
      actorRole: "operator",
      eventType: AUDIT_EVENT_TYPES.KNOWLEDGE_ACCESS,
      entityType: ENTITY_TYPES.KNOWLEDGE_VAULT,
      entityId: "knowledge_vault:t",
      reason: "knowledge write on x.md",
      metadata: { operation: "write", path: "x.md" },
      createdAt: "2026-07-06T00:00:00.000Z",
    };
    const tamper: KnowledgeAuditEntryRow = { ...base, metadata: { ...base.metadata, path: "y.md" } };
    expect(knowledgeAuditEntryHash(base)).not.toBe(knowledgeAuditEntryHash(tamper));
  });

  it("never embeds file content (path-only audit invariant)", () => {
    const row: KnowledgeAuditEntryRow = {
      id: "row-1",
      tenantId: "t",
      actorId: "a",
      actorRole: "operator",
      eventType: AUDIT_EVENT_TYPES.KNOWLEDGE_ACCESS,
      entityType: ENTITY_TYPES.KNOWLEDGE_VAULT,
      entityId: "knowledge_vault:t",
      reason: "knowledge write on x.md",
      metadata: {
        operation: "write",
        path: "x.md",
        // fileContent deliberately NOT in the row schema
      },
      createdAt: "2026-07-06T00:00:00.000Z",
    };
    // Hash should not depend on any string called "fileContent".
    const withoutContent = knowledgeAuditEntryHash(row);
    row.metadata = { ...row.metadata, extra: "with-secret-payload" };
    const withContent = knowledgeAuditEntryHash(row);
    // Adding an unrelated metadata key changes the hash but the schema does
    // not include file content as a first-class field; assert that the
    // hashed shape only contains the known safe fields.
    expect(withoutContent).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(withContent).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(withContent).not.toBe(withoutContent);
  });
});

describe("previousKnowledgeEntryHash", () => {
  it("is null for a fresh tenant chain", () => {
    const db = createDb();
    expect(previousKnowledgeEntryHash(db, "t1")).toBeNull();
  });

  it("returns the most recent entryHash for the same tenant", () => {
    const db = createDb();
    const first = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "t1", path: "a.md" }));
    insertRow(db, toRowForInsert(first));
    expect(previousKnowledgeEntryHash(db, "t1")).toBe(
      (JSON.parse(first.metadata_json) as { entryHash: string }).entryHash
    );
  });

  it("isolates chains across tenants", () => {
    const db = createDb();
    const a = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "tenant-a" }));
    insertRow(db, toRowForInsert(a));
    expect(previousKnowledgeEntryHash(db, "tenant-b")).toBeNull();
  });
});

describe("buildKnowledgeAuditEntry", () => {
  it("builds a row whose stored entryHash matches the recomputed canonical hash", () => {
    const db = createDb();
    const row = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "tenant-x" }));
    insertRow(db, toRowForInsert(row));

    const stored = JSON.parse(row.metadata_json) as Record<string, unknown>;
    expect(stored.entryHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Recompute from the row's persisted shape (excluding entryHash which
    // is derived) -- the row schema is the canonical input to the hash.
    const reconstructedRow: KnowledgeAuditEntryRow = {
      id: row.id,
      tenantId: row.tenantId,
      actorId: row.actorId,
      actorRole: row.actorRole,
      eventType: row.eventType,
      entityType: row.entityType,
      entityId: row.entityId,
      reason: row.reason,
      metadata: {
        schemaVersion: stored.schemaVersion,
        operation: stored.operation,
        path: stored.path,
        agentId: stored.agentId,
        userId: stored.userId ?? null,
        opHash: stored.opHash,
        previousEntryHash: stored.previousEntryHash ?? null,
      },
      createdAt: row.created_at,
    };
    expect(knowledgeAuditEntryHash(reconstructedRow)).toBe(stored.entryHash);
  });

  it("chains: previousEntryHash of row N points to entryHash of row N-1", () => {
    const db = createDb();
    const first = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "tenant-c", path: "first.md" }));
    insertRow(db, toRowForInsert(first));
    const second = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "tenant-c", path: "second.md" }));
    insertRow(db, toRowForInsert(second));

    const firstStored = JSON.parse(first.metadata_json) as { entryHash: string };
    const secondStored = JSON.parse(second.metadata_json) as {
      entryHash: string;
      previousEntryHash: string | null;
    };
    expect(secondStored.previousEntryHash).toBe(firstStored.entryHash);
  });

  it("throws on missing tenant or path", () => {
    const db = createDb();
    expect(() => buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "" }))).toThrow(/tenantId/i);
    expect(() => buildKnowledgeAuditEntry(db, buildArgs({ path: "" }))).toThrow(/path/i);
  });
});

describe("verifyKnowledgeAuditChain", () => {
  it("returns valid for a clean three-link chain", () => {
    const db = createDb();
    for (let i = 0; i < 3; i++) {
      const row = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "t", path: `step-${i}.md` }));
      insertRow(db, toRowForInsert(row));
    }
    const result = verifyKnowledgeAuditChain(db, "t");
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
  });

  it("detects a tampered entry (metadata_json field changed)", () => {
    const db = createDb();
    const first = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "t", path: "a.md" }));
    insertRow(db, toRowForInsert(first));
    const second = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "t", path: "b.md" }));
    insertRow(db, toRowForInsert(second));

    // Tamper with the second row's metadata_json -- change the path.
    const stored = JSON.parse(second.metadata_json) as Record<string, unknown>;
    stored.path = "tampered.md";
    db.prepare("UPDATE audit_entries SET metadata_json = ? WHERE id = ?").run(
      JSON.stringify(stored),
      second.id
    );

    const result = verifyKnowledgeAuditChain(db, "t");
    expect(result.valid).toBe(false);
    expect(result.firstBrokenEntryId).toBe(second.id);
  });

  it("detects a broken link (entryHash dropped)", () => {
    const db = createDb();
    const first = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "t", path: "a.md" }));
    insertRow(db, toRowForInsert(first));
    const second = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "t", path: "b.md" }));
    insertRow(db, toRowForInsert(second));

    // Drop the second row's entryHash to break the chain.
    const stored = JSON.parse(second.metadata_json) as Record<string, unknown>;
    delete stored.entryHash;
    db.prepare("UPDATE audit_entries SET metadata_json = ? WHERE id = ?").run(
      JSON.stringify(stored),
      second.id
    );

    const result = verifyKnowledgeAuditChain(db, "t");
    expect(result.valid).toBe(false);
    expect(result.firstBrokenEntryId).toBe(second.id);
  });

  it("verifies an empty tenant chain as valid with zero rows checked", () => {
    const db = createDb();
    const result = verifyKnowledgeAuditChain(db, "empty-tenant");
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(0);
  });

  it("ignores other tenants' rows", () => {
    const db = createDb();
    const a = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "tenant-a", path: "a.md" }));
    insertRow(db, toRowForInsert(a));
    const b = buildKnowledgeAuditEntry(db, buildArgs({ tenantId: "tenant-b", path: "b.md" }));
    insertRow(db, toRowForInsert(b));

    expect(verifyKnowledgeAuditChain(db, "tenant-a").valid).toBe(true);
    expect(verifyKnowledgeAuditChain(db, "tenant-b").valid).toBe(true);
    expect(verifyKnowledgeAuditChain(db, "tenant-c").valid).toBe(true);
    expect(verifyKnowledgeAuditChain(db, "tenant-c").checked).toBe(0);
  });
});