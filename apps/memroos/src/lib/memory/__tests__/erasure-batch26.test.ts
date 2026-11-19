// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  coordinateErasure,
  getErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";
import { registerEmbeddingProvenance } from "../embedding-lifecycle";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("erasure batch26 — indirect targets, idempotency, FTS and retention resolution", () => {
  it("coordinateErasure records not_linked for indirect stores without adapters", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`orphan-indirect-${randomUUID().slice(0, 8)}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
          (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'operator', 'scope', ?, ?)`,
      )
      .run(
        `er-indirect-${randomUUID().slice(0, 8)}`,
        identity.id,
        JSON.stringify([{ storeId: "orphan_store_batch26", status: "tombstoned" }]),
        new Date().toISOString(),
        new Date().toISOString(),
      );

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-orphan-${randomUUID()}`,
    });
    expect(
      report.storeOutcomes.some((o) => o.storeId === "orphan_store_batch26" && o.status === "zero_match" && o.reason === "not_linked"),
    ).toBe(true);
  });

  it("traverseIndirectDerivatives walks prior erasure report store outcomes", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`prior-report-${randomUUID().slice(0, 8)}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
          (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'operator', 'scope', ?, ?)`,
      )
      .run(
        `er-prior-${randomUUID().slice(0, 8)}`,
        identity.id,
        JSON.stringify([{ storeId: "platform", status: "tombstoned", sourceHash: identity.canonicalHash }]),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "platform" && d.provenance === "erasure_report_snapshot")).toBe(true);
  });

  it("coordinateErasure returns stored report when erasure id is already completed", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`completed-${randomUUID().slice(0, 8)}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const erasureId = `er-completed-${randomUUID().slice(0, 8)}`;
    const storedOutcomes = [{ storeId: "message", status: "tombstoned", reason: "cached_batch26" }];
    const startedAt = "2026-01-01T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
          (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'operator', 'scope', ?, ?)`,
      )
      .run(erasureId, identity.id, JSON.stringify(storedOutcomes), startedAt, startedAt);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      erasureId,
    });
    expect(report.status).toBe("completed");
    expect(report.storeOutcomes).toEqual(storedOutcomes);
    expect(report.completedAt).toBe(startedAt);
  });

  it("fts adapter skips purge when messages row is missing but fts index still has rowid", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "fts-b26", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    const content = "fts batch26";
    database
      .prepare(
        `INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id)
         VALUES (?, ?, 'alpha', '2026-01-01T00:00:00.000Z', 'agent')`,
      )
      .run(messageId, content);
    database.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);

    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch26", metadata: { message_id: messageId } },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("no_fts_rows_for_canonical");
  });

  it("resolveMessageIds includes message ids from memory_retention_records scope", async () => {
    const database = freshDb();
    const { createRetentionPolicy, registerRetentionRecord } = await import("../retention-policy");
    createRetentionPolicy(database, {
      id: `policy-${randomUUID()}`,
      name: "erasure b26",
      ontologyType: "*",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      durationDays: 365,
      priority: 1,
      actorId: "operator",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "retention", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    const canonicalId = `canon-ret-${randomUUID().slice(0, 8)}`;
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha", canonicalId },
      contentHash: createHash("sha256").update("retention").digest("hex"),
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const identity = buildCanonicalIdentity(canonicalId, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "message",
        sourceHash: identity.canonicalHash,
        provenance: "batch26",
        metadata: { message_id: messageId },
      },
    ];
    const adapter = getErasureStoreAdapter("message");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-msg-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.metadata?.message_ids).toContain(messageId);
  });

  it("coordinateErasure maps retained embedding rows to tombstoned store outcomes", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`retained-${randomUUID().slice(0, 8)}`, "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "batch26" }];
    registerEmbeddingProvenance(database, {
      canonicalId: identity.id,
      storeId: "vector",
      sourceHash: identity.canonicalHash,
      modelId: "model-retained",
      provenance: "batch26-retained",
      removability: "retained",
    });

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-retained-${randomUUID()}`,
    });
    const vectorOutcome = report.storeOutcomes.find((o) => o.storeId === "vector");
    expect(vectorOutcome?.status).toBe("tombstoned");
    expect(vectorOutcome?.reason).toBe("removability=retained");
  });
});
