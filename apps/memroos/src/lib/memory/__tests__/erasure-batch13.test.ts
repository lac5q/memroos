// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { coordinateErasure, traverseIndirectDerivatives } from "@/lib/memory/erasure";

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

describe("erasure batch13", () => {
  it("traverseIndirectDerivatives skips implicit cache link when cache snapshot already present", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("cache dedupe", "vault", "ingress", "vault");
    const now = "2026-01-01T00:00:00Z";
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, 'm', '1', 0, 'p', 'active', 'erasable', '{}', ?, ?)`
      )
      .run(`emb-${crypto.randomUUID()}`, identity.id, identity.canonicalHash, now, now);
    const indirect = traverseIndirectDerivatives(database, identity);
    const cacheLinks = indirect.filter((d) => d.storeId === "cache");
    expect(cacheLinks.length).toBeGreaterThanOrEqual(1);
    expect(cacheLinks.some((d) => d.provenance === "implicit_neighbor_link")).toBe(true);
  });

  it("reports vault zero_match when raw_artifacts table is missing", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS raw_artifacts");
    const identity = buildCanonicalIdentity("vault missing", "vault", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vault", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "vault")?.reason).toBe("vault_table_missing");
  });

  it("reports salience unavailable when memory_salience is missing but linked", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_salience");
    const identity = buildCanonicalIdentity("salience missing table", "message", "ingress", "salience", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "salience", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const salience = report.storeOutcomes.find((o) => o.storeId === "salience");
    expect(salience?.status).toBe("unavailable");
    expect(salience?.reason).toBe("memory_salience_missing");
  });

  it("reports candidates zero_match when linked but no rows match", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no candidates", "lesson", "ingress", "candidates", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "candidates", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const candidates = report.storeOutcomes.find((o) => o.storeId === "candidates");
    expect(candidates?.status).toBe("zero_match");
    expect(candidates?.reason).toBe("no_candidates_for_canonical");
  });

  it("vector adapter returns not_linked when identity lacks vector derivative", async () => {
    const database = freshDb();
    const { getErasureStoreAdapter } = await import("../erasure");
    const adapter = getErasureStoreAdapter("vector");
    expect(adapter).toBeTruthy();
    const identity = buildCanonicalIdentity("vector not linked", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked");
  });

  it("persists erasure report when memory_erasure_reports table is absent", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const identity = buildCanonicalIdentity("no report table", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.erasureId).toBeTruthy();
    expect(report.status).toBe("completed");
  });

  it("resolveMessageIds picks up platform_message_memory message_row_id links", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-plat-id", "proj", "agent", "user", "platform id resolve", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    const platformId = `plat-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-01-01T00:00:00Z', ?, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run(
        platformId,
        `dedupe-${platformId}`,
        "platform id resolve",
        crypto.createHash("sha256").update("platform id resolve").digest("hex"),
        messageId
      );
    const identity = buildCanonicalIdentity("platform id resolve", "platform", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "fts")?.status).toBe("purged");
  });
});
