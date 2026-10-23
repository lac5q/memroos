// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter, traverseIndirectDerivatives } from "@/lib/memory/erasure";

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

describe("erasure batch14 — adapters and coordinator edges", () => {
  it("traverseIndirectDerivatives adds implicit cache and context neighbor links", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("implicit neighbors", "message", "ingress", "message");
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "cache" && d.provenance === "implicit_neighbor_link")).toBe(true);
    expect(indirect.some((d) => d.storeId === "context" && d.provenance === "implicit_neighbor_link")).toBe(true);
  });

  it("graph adapter returns not_linked when graph derivative absent", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no graph link", "message", "ingress", "message");
    const adapter = getErasureStoreAdapter("graph");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked:graph");
  });

  it("platform adapter returns no_platform_rows when linked but nothing matches", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("platform empty", "platform", "ingress", "platform", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "platform", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("platform");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("no_platform_rows_for_canonical");
  });

  it("qmd adapter returns not_linked without qmd derivative", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("qmd unlink", "document", "ingress", "document");
    const adapter = getErasureStoreAdapter("qmd");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked");
  });

  it("fts purge skips rowids whose messages row disappeared", async () => {
    const database = freshDb();
    const messageId = 4242;
    database
      .prepare(
        `INSERT INTO messages (id, session_id, project, agent_id, role, content, timestamp)
         VALUES (?, 'sess', 'p', 'agent', 'user', 'fts orphan', '2026-01-01T00:00:00Z')`
      )
      .run(messageId);
    database
      .prepare(
        `INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id)
         VALUES (?, 'fts orphan', 'p', '2026-01-01T00:00:00Z', 'agent')`
      )
      .run(messageId);
    database.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "test",
        metadata: { message_id: String(messageId) },
      },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
  });

  it("embeddings adapter synthesizes provenance when linked with empty ledger", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("embed synth", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("embeddings");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("synthesized_provenance_purged");
  });

  it("coordinateErasure marks failed when vault adapter throws", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("adapter throw", "vault", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vault", sourceHash: identity.canonicalHash, provenance: "test" }];
    const erasureMod = await import("@/lib/memory/erasure");
    erasureMod.registerErasureStoreAdapter({
      storeId: "vault",
      erase: async () => {
        throw new Error("vault_adapter_boom");
      },
    });
    const report = await erasureMod.coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.status).toBe("failed");
    expect(report.storeOutcomes.some((o) => o.storeId === "vault" && o.status === "failed")).toBe(true);
  });

  it("coordinateErasure persists report when memory_erasure_reports table is absent", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const identity = buildCanonicalIdentity("no reports table", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const erasureMod = await import("@/lib/memory/erasure");
    const report = await erasureMod.coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.erasureId).toMatch(/^erasure_/);
    expect(report.storeOutcomes.length).toBeGreaterThan(0);
  });
});
