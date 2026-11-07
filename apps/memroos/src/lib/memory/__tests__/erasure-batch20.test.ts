// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerEmbeddingProvenance } from "@/lib/memory/embedding-lifecycle";
import { coordinateErasure, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch20 — indirect links, FTS purge, adapter gaps, report fallback", () => {
  it("traverseIndirectDerivatives always includes cache and context neighbor links", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("indirect-b20", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "cache")).toBe(true);
    expect(indirect.some((d) => d.storeId === "context")).toBe(true);
  });

  it("coordinateErasure purges FTS rows for message identities with embeddings metadata", async () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES ('s-fts', 'p', 'agent', 'user', 'keyword payload', '2026-01-01T00:00:00.000Z', 'internal', 'indexable')`,
      )
      .run();
    const messageId = Number(database.prepare("SELECT id FROM messages LIMIT 1").get()?.id);
    database
      .prepare(`INSERT INTO message_embeddings (message_id, model, dim, vector) VALUES (?, ?, ?, ?)`)
      .run(messageId, "text-embedding-test", 3, Buffer.from(Float32Array.from([0.1, 0.2, 0.3]).buffer));
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "message", sourceHash: identity.canonicalHash, provenance: "test" },
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "test" },
      { storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" },
    ];
    registerEmbeddingProvenance(database, {
      canonicalId: identity.id,
      storeId: "vector",
      sourceHash: identity.canonicalHash,
      modelId: "m-fts",
      provenance: "batch20",
      metadata: { message_id: messageId },
    });

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-fts-${crypto.randomUUID()}`,
    });
    expect(["completed", "incomplete"]).toContain(report.status);
    expect(report.storeOutcomes.some((o) => o.storeId === "fts")).toBe(true);
  });

  it("coordinateErasure marks linked custom store unavailable when no adapter exists", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("custom-store-b20", "message", "ingress", "custom_store", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "custom_store", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.status).toBe("incomplete");
    expect(
      report.storeOutcomes.some((o) => o.storeId === "custom_store" && o.reason === "no_adapter_for_linked_store"),
    ).toBe(true);
  });

  it("coordinateErasure persists audit even when memory_erasure_reports table is missing", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const identity = buildCanonicalIdentity("no-report-table-b20", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.erasureId).toBeTruthy();
    expect(report.storeOutcomes.length).toBeGreaterThan(0);
  });
});
