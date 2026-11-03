// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  coordinateErasure,
  getErasureStoreAdapter,
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

describe("erasure batch23 — neighbor skip, embeddings purge, transaction fallback", () => {
  it("traverseIndirectDerivatives does not duplicate existing cache/context keys", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`dup-neighbor-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
      derivatives: [
        { storeId: "cache", sourceHash: "hash-cache", provenance: "explicit" },
        { storeId: "context", sourceHash: "hash-context", provenance: "explicit" },
      ],
    });
    const links = traverseIndirectDerivatives(database, identity);
    expect(links.filter((l) => l.storeId === "cache")).toHaveLength(1);
    expect(links.filter((l) => l.storeId === "context")).toHaveLength(1);
  });

  it("embeddings adapter purges synthesized provenance rows", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`emb-store-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("embeddings");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toMatch(/synthesized_provenance_purged/);
  });

  it("coordinateErasure includes zero_match outcomes for unlinked known stores", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`not-linked-${crypto.randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-zero-${crypto.randomUUID()}`,
    });
    expect(report.storeOutcomes.some((o) => o.status === "zero_match" && o.reason === "not_linked")).toBe(true);
  });
});
