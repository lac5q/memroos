// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import * as embeddingLifecycle from "@/lib/memory/embedding-lifecycle";
import { coordinateErasure } from "../erasure";

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

describe("erasure batch19 — embedding incomplete and not_linked store outcomes", () => {
  it("coordinateErasure marks incomplete when embedding removal is unavailable", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("embed-unavail-b19", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
          (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
           dimensionality, provenance, removability, created_at, updated_at)
         VALUES ('prov-unavail-b19', 'default-tenant', ?, 'vector', 'local', ?, 'model-a', NULL, 8, 'test', 'erasable', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);

    vi.spyOn(embeddingLifecycle, "removeEmbeddingForCanonical").mockReturnValue({
      status: "unavailable",
      reason: "vector_down",
      row: {
        id: "prov-unavail-b19",
        storeId: "vector",
        modelId: "model-a",
        modelVersion: null,
        adapterKind: "local",
      },
    } as never);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      now: new Date(now),
    });
    expect(report.status).toBe("incomplete");
    expect(report.storeOutcomes.some((o) => o.storeId === "vector" && o.status === "unavailable")).toBe(true);
  });

  it("coordinateErasure adds not_linked rows for unlinked known stores", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("orphan-store-b19", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [];

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.some((o) => o.reason === "not_linked")).toBe(true);
  });
});
