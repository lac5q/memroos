// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import {
  LocalMessageEmbeddingAdapter,
  markEmbeddingDegraded,
  markEmbeddingStale,
  registerEmbeddingProvenance,
  removeEmbeddingForCanonical,
} from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch33 — row guards, adapter paths, synthesized reread", () => {
  it("registerEmbeddingProvenance synthesizes row when reread is null (200, 208-214)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b33-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-synth-b33",
      provenance: "batch33",
      modelVersion: null,
      dimensionality: 128,
      metadata: { lane: "batch33" },
    });
    expect(row.modelVersion).toBeNull();
    expect(row.dimensionality).toBe(128);
    expect(row.metadata.lane).toBe("batch33");
  });

  it("markEmbeddingStale returns existing row when lifecycle is removed (292)", () => {
    const database = freshDb();
    const base = registerEmbeddingProvenance(database, {
      canonicalId: `stale-b33-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-stale-b33",
      provenance: "batch33",
    });
    database
      .prepare(`UPDATE memory_embedding_provenance SET lifecycle_state = 'removed' WHERE id = ?`)
      .run(base.id);
    const row = markEmbeddingStale(database, {
      tenantId: base.tenantId,
      id: base.id,
      reason: "stale-b33",
    });
    expect(row?.lifecycleState).toBe("removed");
  });

  it("markEmbeddingDegraded returns null when provenance row is missing (323)", () => {
    const database = freshDb();
    expect(
      markEmbeddingDegraded(database, {
        tenantId: "default-tenant",
        id: `missing-b33-${randomUUID()}`,
        reason: "degraded",
      }),
    ).toBeNull();
  });

  it("removeEmbeddingForCanonical rejects adapter store mismatch (381) and maps unavailable (410)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `rm-b33-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-rm-b33",
      provenance: "batch33",
    });
    const mismatch = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: { storeId: "embeddings", delete: () => true },
    });
    expect(mismatch.status).toBe("failed");

    const unavailable = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: {
        storeId: "vector",
        delete: () => {
          throw new Error("adapter_down_b33");
        },
      },
    });
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.reason).toBe("adapter_down_b33");
  });

  it("LocalMessageEmbeddingAdapter deletes message_embeddings by metadata message_id (436)", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b33-${randomUUID()}`, "alpha", "agent", "user", "embed-b33", "2026-03-03T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO message_embeddings(message_id, model, dim, vector) VALUES (?, 'm-b33', 4, ?)`)
      .run(messageId, Buffer.alloc(16));

    const row = registerEmbeddingProvenance(database, {
      canonicalId: `emb-delete-b33-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-vec-b33",
      provenance: "batch33",
      metadata: { message_id: messageId },
    });

    const adapter = new LocalMessageEmbeddingAdapter(database, "vector");
    expect(adapter.delete(row.tenantId, row)).toBe(true);
    expect(database.prepare(`SELECT COUNT(*) AS c FROM message_embeddings WHERE message_id = ?`).get(messageId)).toEqual({
      c: 0,
    });
  });

  it.skip("removeEmbeddingForCanonical failed status branch (413) — adapterOutcome never assigns literal failed", () => {
    // Type-level union excludes persisted failed adapter path after remove guards.
  });
});
