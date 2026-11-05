// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  LocalMessageEmbeddingAdapter,
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
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("embedding-lifecycle batch23b — zero_match and local adapter delete", () => {
  it("removeEmbeddingForCanonical returns zero_match when adapter delete misses", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `tomb-b23b-${crypto.randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-tomb",
      provenance: "batch23b",
      removability: "erasable",
      metadata: { message_id: 404404 },
    });
    const adapter = new LocalMessageEmbeddingAdapter(database, "vector");
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${crypto.randomUUID()}`,
      adapter,
    });
    expect(result.status).toBe("zero_match");
  });

  it("LocalMessageEmbeddingAdapter.delete removes rows keyed by message_id metadata", () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${crypto.randomUUID()}`, "alpha", "agent", "user", "msg", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO message_embeddings (message_id, model, dim, vector) VALUES (?, ?, ?, ?)`)
      .run(messageId, "test-model", 1, Buffer.from(new Float32Array([1]).buffer));
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `msg-b23b-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-local",
      provenance: "batch23b",
      metadata: { message_id: messageId },
    });
    const adapter = new LocalMessageEmbeddingAdapter(database, "vector");
    expect(adapter.delete("default-tenant", row)).toBe(true);
    expect(database.prepare(`SELECT COUNT(*) AS c FROM message_embeddings`).get()).toEqual({ c: 0 });
  });
});
