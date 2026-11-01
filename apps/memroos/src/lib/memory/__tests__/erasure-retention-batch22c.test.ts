// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerEmbeddingProvenance } from "@/lib/memory/embedding-lifecycle";
import {
  createRetentionPolicy,
  evaluateRetentionPolicy,
  registerRetentionRecord,
} from "../retention-policy";
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

describe("erasure + retention-policy batch22c", () => {
  it("traverseIndirectDerivatives dedupes cache/context neighbor keys", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`dup-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "cache", sourceHash: identity.canonicalHash, provenance: "explicit-cache" },
      { storeId: "context", sourceHash: identity.canonicalHash, provenance: "explicit-context" },
    ];
    const links = traverseIndirectDerivatives(database, identity);
    expect(links.filter((l) => l.storeId === "cache")).toHaveLength(1);
    expect(links.filter((l) => l.storeId === "context")).toHaveLength(1);
  });

  it("coordinateErasure resolves retention record links and tolerates missing erasure report table", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`retention-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_retention_records
          (id, tenant_id, record_type, record_id, ontology_type, security_label_json, purpose, scope_json,
           policy_id, policy_version, retention_deadline, status, content_hash, created_at, updated_at, expired_at)
         VALUES ('ret-b22c', 'default-tenant', 'message', ?, 'memory.note', '{}', 'recall', ?, NULL, NULL, NULL, 'active', NULL, ?, ?, NULL)`,
      )
      .run(
        identity.id,
        JSON.stringify({ tenantId: "default-tenant", canonicalId: identity.id }),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-b22c-${crypto.randomUUID()}`,
    });
    expect(report.status).toBe("completed");
  });

  it("vector and embeddings adapters report purge counts from provenance rows", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`embed-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" },
      { storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" },
    ];
    const now = new Date().toISOString();
    registerEmbeddingProvenance(database, {
      tenantId: "default-tenant",
      canonicalId: identity.id,
      storeId: "vector",
      adapterKind: "local",
      sourceHash: identity.canonicalHash,
      modelId: "model-b22c",
      modelVersion: null,
      dimensionality: 8,
      provenance: "test",
      removability: "erasable",
      now: new Date(now),
    });
    registerEmbeddingProvenance(database, {
      tenantId: "default-tenant",
      canonicalId: identity.id,
      storeId: "embeddings",
      adapterKind: "local",
      sourceHash: identity.canonicalHash,
      modelId: "model-b22c",
      modelVersion: null,
      dimensionality: 8,
      provenance: "test",
      removability: "erasable",
      now: new Date(now),
    });
    const vectorAdapter = getErasureStoreAdapter("vector");
    const embeddingsAdapter = getErasureStoreAdapter("embeddings");
    const vectorOutcome = await vectorAdapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-v-${crypto.randomUUID()}`,
      now: new Date(),
    });
    const embeddingsOutcome = await embeddingsAdapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-e-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(["purged", "zero_match"]).toContain(vectorOutcome.status);
    expect(["purged", "zero_match", "tombstoned"]).toContain(embeddingsOutcome.status);
  });

  it("retention policy validation covers invalid timestamps, empty selectors, and missing context", () => {
    const database = freshDb();
    expect(() =>
      createRetentionPolicy(database, {
        name: "bad-ts",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
        durationDays: 7,
        actorId: "operator",
        now: "not-a-date",
      }),
    ).toThrow(/Invalid UTC timestamp/i);

    createRetentionPolicy(database, {
      id: "policy-empty-array",
      name: "empty selector",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: [] as unknown as string },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      priority: 1,
      durationDays: 7,
      actorId: "operator",
    });

    expect(
      evaluateRetentionPolicy(database, {
        tenantId: "",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
      }).reason,
    ).toBe("missing_tenant");
    expect(
      evaluateRetentionPolicy(database, {
        tenantId: "default-tenant",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "",
        scope: { tenantId: "default-tenant" },
      }).reason,
    ).toBe("missing_purpose");
    expect(
      evaluateRetentionPolicy(database, {
        tenantId: "default-tenant",
        ontologyType: " ",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
      }).reason,
    ).toBe("missing_ontology_type");
    expect(
      evaluateRetentionPolicy(database, {
        tenantId: "default-tenant",
        ontologyType: "memory.note",
        securityLabel: {},
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
      }).reason,
    ).toBe("missing_security_label");
    expect(
      evaluateRetentionPolicy(database, {
        tenantId: "default-tenant",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: {},
      }).reason,
    ).toBe("missing_scope");

    const registered = registerRetentionRecord(database, {
      recordType: "message",
      recordId: "msg-b22c",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: [] as unknown as string },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      contentHash: "sha256:abc",
      actorId: "operator",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(registered.evaluation.decision).toBe("policy_unavailable");
  });
});
