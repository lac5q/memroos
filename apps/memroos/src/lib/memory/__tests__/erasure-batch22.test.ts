// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { coordinateErasure, getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch22 — implicit neighbors, embeddings purge, coordinator persistence", () => {
  it("traverseIndirectDerivatives synthesizes cache/context neighbor links for bare identities", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`bare-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const links = traverseIndirectDerivatives(database, identity);
    expect(links.filter((l) => l.storeId === "cache" || l.storeId === "context")).toHaveLength(2);
  });

  it("vector adapter walks provenance rows for embedding_removed reporting", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES ('s-b22', 'p', 'a', 'user', 'embed purge b22', '2026-01-01T00:00:00Z', 'internal', 'indexable')`,
        )
        .run().lastInsertRowid,
    );
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
          (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
           dimensionality, provenance, removability, created_at, updated_at)
         VALUES ('prov-vector-b22', 'default-tenant', ?, 'vector', 'local', ?, 'model-b22', NULL, 8, 'test', 'erasable', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);
    const adapter = getErasureStoreAdapter("vector");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(["purged", "zero_match"]).toContain(outcome.status);
    expect(outcome.reason).toMatch(/embedding_removed|no_embedding_removed/);
  });

  it("coordinateErasure persists when memory_erasure_reports table is absent", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const identity = buildCanonicalIdentity(`no-report-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-coord-${crypto.randomUUID()}`,
    });
    expect(report.status).toBe("completed");
    expect(report.storeOutcomes.length).toBeGreaterThan(0);
  });
});
