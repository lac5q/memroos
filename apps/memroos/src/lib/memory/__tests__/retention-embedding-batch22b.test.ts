// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import {
  activeLegalHoldsForRecord,
  createLegalHold,
  runRetentionExpiry,
} from "../retention-expiry";
import {
  markEmbeddingDegraded,
  markEmbeddingStale,
  registerEmbeddingProvenance,
} from "../embedding-lifecycle";

describe("retention-expiry + embedding-lifecycle batch22b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("runRetentionExpiry rejects invalid now timestamps", () => {
    expect(() =>
      runRetentionExpiry(db, { runKey: "bad-ts", now: new Date("not-a-date") as unknown as Date }),
    ).toThrow(/Invalid (UTC timestamp|time value)/);
  });

  it("activeLegalHoldsForRecord matches array scope filters", () => {
    createRetentionPolicy(db, {
      id: "policy-b22b",
      name: "policy",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal", sensitivity: "pii" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      priority: 5,
      durationDays: 30,
      actorId: "operator",
    });
    const record = registerRetentionRecord(db, {
      recordType: "message",
      recordId: "note-1",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal", sensitivity: "pii" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha", recordType: "note", recordId: "note-1" },
      contentHash: "hash:note-1",
      actorId: "operator",
    });
    createLegalHold(db, {
      scope: { recordType: ["message"] },
      reasonCode: "legal",
      actorId: "operator",
    });
    const row = db
      .prepare(`SELECT * FROM memory_retention_records WHERE record_id = ?`)
      .get("note-1") as { record_id: string; tenant_id: string; record_type: string; scope_json: string };
    const holds = activeLegalHoldsForRecord(db, row as never, new Date());
    expect(holds.length).toBe(1);
  });

  it("markEmbeddingStale and markEmbeddingDegraded no-op on removed rows", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "default-tenant",
      canonicalId: `canon-${crypto.randomUUID().slice(0, 8)}`,
      storeId: "store-a",
      modelId: "model-a",
      adapterKind: "local",
      sourceHash: `sha256:${"c".repeat(64)}`,
      provenance: "unit-test",
    });
    db.prepare(`UPDATE memory_embedding_provenance SET lifecycle_state = 'removed' WHERE tenant_id = ? AND id = ?`).run(
      "default-tenant",
      row.id,
    );
    const stale = markEmbeddingStale(db, { tenantId: "default-tenant", id: row.id, reason: "stale" });
    const degraded = markEmbeddingDegraded(db, { tenantId: "default-tenant", id: row.id, reason: "degraded" });
    expect(stale?.lifecycleState).toBe("removed");
    expect(degraded?.lifecycleState).toBe("removed");
  });
});
