// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerEmbeddingProvenance } from "@/lib/memory/embedding-lifecycle";
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
});

describe("erasure batch21 — embedding failures and zero_match stores", () => {
  it("marks overall erasure failed when embedding adapter store mismatches", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("erase-fail-b21", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" },
    ];
    registerEmbeddingProvenance(database, {
      canonicalId: identity.id,
      storeId: "embeddings",
      sourceHash: identity.canonicalHash,
      modelId: "m-b21",
      provenance: "batch21",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-fail-${crypto.randomUUID()}`,
    });
    expect(report.status).toBe("failed");
    expect(report.storeOutcomes.some((o) => o.storeId === "embeddings" && o.status === "failed")).toBe(true);
  });

  it("reports zero_match for indirect neighbor stores without adapters", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(String(crypto.randomUUID()), "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-zero-${crypto.randomUUID()}`,
    });
    const outcome = report.storeOutcomes.find((o) => o.status === "zero_match" && o.reason === "not_linked");
    expect(outcome).toBeDefined();
  });
});
