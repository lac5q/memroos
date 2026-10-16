// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createLegalHold } from "../retention-expiry";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import { approveSubjectErasurePlan, createSubjectErasurePlan, executeSubjectErasurePlan } from "../subject-erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: "policy-subject",
    name: "subject policy",
    ontologyType: "*",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", project: "alpha" },
    durationDays: 365,
    priority: 1,
    actorId: "operator",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return db;
}

function seedMessage(database: Database.Database, content: string, subjectId: string, name = "Alice Example"): number {
  const messageId = database
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?)`
    )
    .run(`sess-${subjectId}-${Math.random()}`, "alpha", "agent", "user", content, "2026-01-01T00:00:00.000Z", "internal", "indexable")
    .lastInsertRowid as number;
  database
    .prepare("INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?, 'mid', 1.0, ?)")
    .run(messageId, "2025-12-31T00:00:00.000Z");
  registerRetentionRecord(database, {
    recordType: "message",
    recordId: String(messageId),
    ontologyType: "memory.contact_event",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", subjectId, name },
    contentHash: `hash-${messageId}`,
    actorId: "operator",
    createdAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return messageId;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("subject erasure planning and execution", () => {
  it("matches retention records via externalId subject aliases", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`
      )
      .run(
        "sess-ext",
        "alpha",
        "agent",
        "user",
        "external subject payload",
        "2026-01-01T00:00:00.000Z",
        "internal",
        "indexable"
      ).lastInsertRowid as number;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        externalId: "crm-contact-42",
      },
      contentHash: `hash-ext-${messageId}`,
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const result = createSubjectErasurePlan(database, {
      subject: { externalId: "crm-contact-42" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.matchedRecords).toHaveLength(1);
    expect(result.plan?.matchedRecords[0]?.recordId).toBe(String(messageId));
  });

  it("VAL-MEM-019: resolves subject records and derivative coverage without raw payload", () => {
    const database = freshDb();
    const messageId = seedMessage(database, "SECRET_PAYLOAD_FOR_ALICE", "subject-alpha");

    const result = createSubjectErasurePlan(database, {
      id: "plan-alpha",
      subject: { subjectId: "subject-alpha" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.matchedRecords).toHaveLength(1);
    expect(result.plan?.matchedRecords[0]).toMatchObject({ recordType: "message", recordId: String(messageId), ontologyType: "memory.contact_event" });
    expect(result.plan?.coverage.map((item) => item.storeId)).toEqual(
      expect.arrayContaining(["message", "fts", "salience", "embeddings", "graph", "qmd", "cache", "context", "vault"])
    );
    const serializedPlan = JSON.stringify(result.plan);
    expect(serializedPlan).not.toContain("SECRET_PAYLOAD_FOR_ALICE");
    expect(serializedPlan).not.toContain("subject-alpha");
    expect(result.plan?.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("VAL-MEM-020: colliding names and missing scope fail closed without mutation", () => {
    const database = freshDb();
    seedMessage(database, "RAW_ALICE_ONE", "subject-one", "Shared Name");
    seedMessage(database, "RAW_ALICE_TWO", "subject-two", "Shared Name");

    const ambiguous = createSubjectErasurePlan(database, {
      subject: { name: "Shared Name" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.candidates).toHaveLength(2);
    expect(JSON.stringify(ambiguous)).not.toContain("RAW_ALICE");

    const missingScope = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-one" },
      scope: { tenantId: "default-tenant" },
      actorId: "operator",
    });
    expect(missingScope.ok).toBe(false);
    expect(missingScope.reason).toBe("missing_purpose");
    expect((database.prepare("SELECT COUNT(*) AS count FROM memory_subject_erasure_plans").get() as { count: number }).count).toBe(0);
  });

  it("VAL-MEM-021: execution requires approved current plan hash and source-version coverage", async () => {
    const database = freshDb();
    seedMessage(database, "SECRET_STALE_ONE", "subject-stale");
    const plan = createSubjectErasurePlan(database, {
      id: "plan-stale",
      subject: { subjectId: "subject-stale" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    approveSubjectErasurePlan(database, {
      planId: "plan-stale",
      planHash: plan.plan!.planHash,
      actorId: "reviewer",
      now: new Date("2026-01-02T00:10:00.000Z"),
    });

    seedMessage(database, "SECRET_STALE_TWO", "subject-stale");

    let staleError: unknown;
    try {
      await executeSubjectErasurePlan(database, {
        planId: "plan-stale",
        planHash: plan.plan!.planHash,
        actorId: "operator",
        now: new Date("2026-01-02T00:20:00.000Z"),
      });
    } catch (err) {
      staleError = err;
    }

    expect(staleError).toBeInstanceOf(Error);
    expect((staleError as Error).message).toContain("subject erasure plan is stale");
  });

  it("VAL-MEM-018/022: erases eligible subject payload while held records stay blocked and incomplete", async () => {
    const database = freshDb();
    const unheldId = seedMessage(database, "SECRET_UNHELD_PAYLOAD", "subject-mixed");
    const heldId = seedMessage(database, "SECRET_HELD_PAYLOAD", "subject-mixed");
    createLegalHold(database, {
      id: "hold-subject",
      scope: { tenantId: "default-tenant", recordId: String(heldId) },
      reasonCode: "litigation",
      actorId: "legal",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    const plan = createSubjectErasurePlan(database, {
      id: "plan-mixed",
      subject: { subjectId: "subject-mixed" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:05:00.000Z"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.plan?.estimatedEffects.heldCount).toBe(1);
    approveSubjectErasurePlan(database, {
      planId: "plan-mixed",
      planHash: plan.plan!.planHash,
      actorId: "reviewer",
      now: new Date("2026-01-02T00:10:00.000Z"),
    });

    const execution = await executeSubjectErasurePlan(database, {
      planId: "plan-mixed",
      planHash: plan.plan!.planHash,
      actorId: "operator",
      now: new Date("2026-01-02T00:15:00.000Z"),
    });

    expect(execution.status).toBe("incomplete");
    expect(execution.erased).toBe(1);
    expect(execution.blocked).toBe(1);
    expect(database.prepare("SELECT content FROM messages WHERE id = ?").get(unheldId)).toMatchObject({ content: "[erased]" });
    expect(database.prepare("SELECT content FROM messages WHERE id = ?").get(heldId)).toMatchObject({ content: "SECRET_HELD_PAYLOAD" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM memory_salience WHERE message_id = ?").get(unheldId) as { count: number }).count).toBe(0);
    const ftsResidual = database.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").all("SECRET_UNHELD_PAYLOAD");
    expect(ftsResidual).toHaveLength(0);
    const tombstones = database.prepare("SELECT COUNT(*) AS count FROM memory_erasure_tombstones WHERE subject_plan_id = ?").get("plan-mixed") as { count: number };
    expect(tombstones.count).toBe(1);
  });

  it("revokes a versioned ontology record during approved subject erasure", async () => {
    const database = freshDb();
    const messageId = seedMessage(database, "ONTOLOGY_ERASURE_SECRET", "subject-ontology");
    const registry = await import("@/lib/ontology/registry");
    const ontology = registry.ensureCanonicalUpperOntology(database, "operator");
    const sourceId = `subject-source:${messageId}`;
    const sourceHash = `sha256:${"e".repeat(64)}`;
    const recordId = `subject-versioned:${messageId}`;
    database.prepare(`INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code) VALUES ('default-tenant', 'erasure-space', ?, ?, 'active', ?, 'operator', 'test')`)
      .run(sourceId, sourceHash, new Date().toISOString());
    database.prepare(`INSERT INTO ontology_versioned_records (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash) VALUES (?, 'default-tenant', 'erasure-space', 'message', ?, 'memory', ?, ?, ?, 'legacy_message', '[]', ?, ?, ?)`)
      .run(recordId, String(messageId), ontology.ontologyId, ontology.version, ontology.contentHash, new Date().toISOString(), sourceId, sourceHash);
    database.prepare(`INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at) VALUES (?, 'default-tenant', 'erasure-space', ?, ?, 'versioned_record', ?, 'authoritative', ?)`)
      .run(`subject-valid:${messageId}`, sourceId, sourceHash, recordId, new Date().toISOString());
    const plan = createSubjectErasurePlan(database, {
      id: "plan-ontology",
      subject: { subjectId: "subject-ontology" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    approveSubjectErasurePlan(database, {
      planId: "plan-ontology", planHash: plan.plan!.planHash, actorId: "reviewer", now: new Date("2026-01-02T00:10:00.000Z"),
    });
    await executeSubjectErasurePlan(database, {
      planId: "plan-ontology", planHash: plan.plan!.planHash, actorId: "operator", now: new Date("2026-01-02T00:20:00.000Z"),
    });

    expect(database.prepare(`SELECT status FROM ontology_derivative_validity WHERE derivative_type = 'versioned_record'`).get())
      .toMatchObject({ status: "revoked" });
  });
});
