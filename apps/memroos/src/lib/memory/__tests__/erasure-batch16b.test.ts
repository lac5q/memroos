// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  ErasureAuthorizationError,
  KNOWN_STORES,
  coordinateErasure,
  deriveErasureId,
  registerErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";

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

describe("erasure batch16b — ids, registration, traversal, scope auth", () => {
  it("deriveErasureId is stable and uses erasure_ prefix", () => {
    const a = deriveErasureId("tenant-a", "canon-1");
    const b = deriveErasureId("tenant-a", "canon-1");
    const c = deriveErasureId("tenant-b", "canon-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^erasure_[0-9a-f]{64}$/);
    expect(c).not.toBe(a);
  });

  it("registerErasureStoreAdapter rejects unknown store ids", () => {
    expect(() =>
      registerErasureStoreAdapter({
        storeId: "not-a-real-store" as never,
        erase: async () => ({ status: "purged", reason: "test" }),
      }),
    ).toThrow(/unknown storeId/);
    expect(KNOWN_STORES).toContain("embeddings");
  });

  it("traverseIndirectDerivatives returns empty for falsy source", () => {
    const database = freshDb();
    expect(traverseIndirectDerivatives(database, "")).toEqual([]);
  });

  it("traverseIndirectDerivatives reads embedding provenance neighbors", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("msg-99", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, dimensionality,
          provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, 'cache', 'local', ?, 'm1', 8, 'test', 'active', 'erasable', '{}', ?, ?)`,
      )
      .run(
        `emb_${crypto.randomUUID().slice(0, 16)}`,
        "default-tenant",
        identity.id,
        identity.canonicalHash,
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "cache")).toBe(true);
  });

  it("coordinateErasure throws ErasureAuthorizationError on empty scope", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("auth-1", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    await expect(
      coordinateErasure(database, identity, {
        actorId: "operator",
        scope: {},
      }),
    ).rejects.toBeInstanceOf(ErasureAuthorizationError);
  });

  it("coordinateErasure rejects options.tenantId mismatch against scope", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("auth-2", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    await expect(
      coordinateErasure(database, identity, {
        actorId: "operator",
        tenantId: "other-tenant",
        scope: { tenantId: "default-tenant", purpose: "dsar" },
      }),
    ).rejects.toMatchObject({ code: "wrong_tenant" });
  });
});
