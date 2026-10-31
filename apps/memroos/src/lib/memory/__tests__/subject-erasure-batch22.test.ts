// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import {
  approveSubjectErasurePlan,
  createSubjectErasurePlan,
  executeSubjectErasurePlan,
} from "../subject-erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  createRetentionPolicy(db, {
    id: `policy-${crypto.randomUUID()}`,
    name: "subject batch22",
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

function registerMessage(
  database: Database.Database,
  subjectId: string,
  scopeExtras: Record<string, unknown> = {},
): number {
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
      "erase-me",
      "2026-01-01T00:00:00.000Z",
      "internal",
      "indexable",
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
      subjectId,
      ...scopeExtras,
    },
    contentHash: `hash-${messageId}`,
    actorId: "operator",
    createdAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return messageId;
}

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("subject-erasure batch22 — scope filters, federation, execution", () => {
  it("scopeMatches ignores subject keys and rejects recordType mismatches", () => {
    const database = freshDb();
    registerMessage(database, "subject-scope-b22", { recordType: "message" });
    registerRetentionRecord(database, {
      recordType: "agent_memory_candidate",
      recordId: crypto.randomUUID(),
      ontologyType: "memory.lesson",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        subjectId: "subject-scope-b22",
        recordType: "agent_memory_candidate",
      },
      contentHash: crypto.randomUUID(),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const filtered = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-scope-b22" },
      scope: {
        tenantId: "default-tenant",
        purpose: "recall",
        project: "alpha",
        recordType: "message",
        subjectId: "ignored-subject-key",
      },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(filtered.plan?.matchedRecords).toHaveLength(1);
    expect(filtered.plan?.matchedRecords[0]?.recordType).toBe("message");
  });

  it("derivative inventory includes federation store when active derivative exists", () => {
    const database = freshDb();
    const subjectId = `subject-fed-b22-${crypto.randomUUID().slice(0, 8)}`;
    const messageId = registerMessage(database, subjectId);
    const canonicalId = `canon-${messageId}`;
    database
      .prepare(`UPDATE memory_retention_records SET scope_json = ? WHERE record_id = ?`)
      .run(
        JSON.stringify({
          tenantId: "default-tenant",
          purpose: "recall",
          project: "alpha",
          subjectId,
          canonicalMemoryId: canonicalId,
        }),
        String(messageId),
      );
    database
      .prepare(
        `INSERT INTO federation_action_artifacts
         (id, tenant_id, space_id, federation_run_id, pack_hash, pack_bytes, pack_item_count,
          bound_status, scope_hash, policy_hash, ontology_hash, artifact_hash)
         VALUES (?, 'default-tenant', 'space-1', 'run-b22', 'ph', 1, 1, 'bounded', 'sh', 'ph2', 'oh', 'ah')`,
      )
      .run(`fed-art-${messageId}`);
    database
      .prepare(
        `INSERT INTO federation_action_derivatives
         (id, tenant_id, artifact_id, canonical_id, canonical_hash, source_id, status)
         VALUES (?, 'default-tenant', ?, ?, ?, ?, 'active')`,
      )
      .run(`fed-deriv-${messageId}`, `fed-art-${messageId}`, canonicalId, crypto.randomUUID(), String(messageId));

    const plan = createSubjectErasurePlan(database, {
      subject: { subjectId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(plan.plan?.coverage.some((c) => c.storeId === "federation")).toBe(true);
  });

  it("executeSubjectErasurePlan increments failed when coordinateErasure reports failure", async () => {
    const database = freshDb();
    const subjectId = `subject-exec-b22-${crypto.randomUUID().slice(0, 8)}`;
    registerMessage(database, subjectId);
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    approveSubjectErasurePlan(database, {
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    const erasureMod = await import("../erasure");
    vi.spyOn(erasureMod, "coordinateErasure").mockResolvedValue({
      status: "failed",
      storeOutcomes: [{ storeId: "message", status: "failed", reason: "simulated" }],
    } as never);

    const executed = await executeSubjectErasurePlan(database, {
      planId: planned.plan.id,
      planHash: planned.plan.planHash,
      actorId: "operator",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    expect(executed.failed).toBeGreaterThan(0);
    expect(executed.status).toMatch(/failed|partial/);
  });

  it("approveSubjectErasurePlan rejects when recomputed plan is no longer planned", () => {
    const database = freshDb();
    registerMessage(database, "subject-deny-b22");
    const planned = createSubjectErasurePlan(database, {
      subject: { subjectId: "subject-deny-b22" },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      actorId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    if (!planned.plan) throw new Error("missing plan");
    database.prepare("DELETE FROM memory_retention_records").run();
    expect(() =>
      approveSubjectErasurePlan(database, {
        planId: planned.plan.id,
        planHash: planned.plan.planHash,
        actorId: "operator",
        now: new Date("2026-01-04T00:00:00.000Z"),
      }),
    ).toThrow(/no longer executable/);
  });
});
