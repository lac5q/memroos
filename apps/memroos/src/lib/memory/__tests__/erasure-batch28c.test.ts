// @vitest-environment node
import { randomUUID } from "node:crypto";
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

describe("erasure batch28c — indirect neighbors, FTS purge, report fallback", () => {
  it("traverseIndirectDerivatives synthesizes cache/context links for bare ids (lines 336-343)", () => {
    const database = freshDb();
    const indirect = traverseIndirectDerivatives(database, "canonical-id-only-28c");
    const storeIds = indirect.map((d) => d.storeId).sort();
    expect(storeIds).toEqual(["cache", "context"]);
    expect(indirect.every((d) => d.provenance === "implicit_neighbor_link")).toBe(true);
  });

  it("fts adapter purges indexed rows when only fts is linked (lines 483-505)", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`,
        )
        .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "fts purge batch28c body", "2026-01-04T00:00:00.000Z")
        .lastInsertRowid,
    );

    const identity = buildCanonicalIdentity("fts purge batch28c body", "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch28c",
        metadata: { message_id: messageId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("messages_fts_rows_deleted");
  });

  it("coordinateErasure still audits when memory_erasure_reports table is absent (lines 1308-1310)", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const identity = buildCanonicalIdentity(`coord-28c-${randomUUID().slice(0, 8)}`, "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "graph", sourceHash: identity.canonicalHash, provenance: "batch28c" },
    ];

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator-28c",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.erasureId).toMatch(/^erasure_/);
    expect(report.storeOutcomes.length).toBeGreaterThan(0);
  });

  it("traverseIndirectDerivatives skips duplicate cache keys from provenance ledger (line 338 continue)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("cache dedupe batch28c", "message", "ingress", "vector");
    const now = "2026-01-01T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, 'm1', '1.0', 0, 'p', 'active', 'erasable', '{}', ?, ?)`,
      )
      .run(`emb-28c-${randomUUID().slice(0, 6)}`, identity.id, identity.canonicalHash, now, now);

    const indirect = traverseIndirectDerivatives(database, identity);
    const cacheLinks = indirect.filter((d) => d.storeId === "cache");
    expect(cacheLinks.some((d) => d.provenance.startsWith("embedding_provenance:"))).toBe(true);
    expect(cacheLinks.length).toBeGreaterThanOrEqual(1);
  });
});
