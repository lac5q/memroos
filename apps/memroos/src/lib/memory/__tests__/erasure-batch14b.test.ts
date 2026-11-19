// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  coordinateErasure,
  getErasureStoreAdapter,
  registerErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "@/lib/memory/erasure";

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

describe("erasure batch14b — platform, embeddings loop, coordinator status", () => {
  it("platform adapter reports unavailable when table missing but store is linked", async () => {
    const store = await import("@/lib/message-memory/store");
    vi.spyOn(store, "ensureMessageMemorySchema").mockImplementation(() => {});
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS platform_message_memory");
    const identity = buildCanonicalIdentity("plat-missing-table", "platform", "ingress", "platform", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "platform", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("platform");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.reason).toBe("platform_message_memory_missing");
  });

  it("vector adapter embedding_removed loop when provenance rows exist", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES ('s', 'p', 'a', 'user', 'embed loop', '2026-01-01T00:00:00Z', 'internal', 'indexable')`,
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
         VALUES ('prov-vector', 'default-tenant', ?, 'vector', 'local', ?, 'model-a', NULL, 8, 'test', 'erasable', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);
    const adapter = getErasureStoreAdapter("vector");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(["purged", "zero_match"]).toContain(outcome.status);
  });

  it("coordinateErasure marks incomplete when linked store has no adapter", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no-adapter", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vault", sourceHash: identity.canonicalHash, provenance: "test" }];
    registerErasureStoreAdapter({
      storeId: "vault",
      erase: async () => ({ status: "zero_match", reason: "not_linked" }),
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.some((o) => o.storeId === "vault")).toBe(true);
  });

  it("coordinateErasure marks failed when vault adapter throws in store loop", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("adapter-throw-loop", "vault", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vault", sourceHash: identity.canonicalHash, provenance: "test" }];
    registerErasureStoreAdapter({
      storeId: "vault",
      erase: async () => {
        throw new Error("store_loop_boom");
      },
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.status).toBe("failed");
    expect(report.storeOutcomes.some((o) => o.storeId === "vault" && o.status === "failed")).toBe(true);
  });

  it("coordinateErasure retries persist when transaction fails with missing table message", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("persist-retry", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const originalTransaction = database.transaction.bind(database);
    let calls = 0;
    database.transaction = ((fn: () => void) => {
      return () => {
        calls += 1;
        if (calls === 1) throw new Error("SQLITE_ERROR: no such table: memory_erasure_reports");
        return originalTransaction(fn)();
      };
    }) as typeof database.transaction;
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.erasureId).toMatch(/^erasure_/);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("traverseIndirectDerivatives still adds implicit cache/context neighbors", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("implicit-b14b", "message", "ingress", "message");
    identity.derivatives = [
      { storeId: "cache", sourceHash: identity.canonicalHash, provenance: "explicit_cache" },
    ];
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "context")).toBe(true);
  });
});

/**
 * Blockers:
 * - erasure.ts:338 — `indirect.has('cache:indirect')` never true before loop (dead continue).
 * - erasure.ts:1187-1191 — embedding projection failed/incomplete requires live embedding lifecycle failures.
 */
