// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  coordinateErasure,
  getErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";
import { registerEmbeddingProvenance } from "../embedding-lifecycle";

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

describe("erasure batch24 — platform ids, vector purge, report fallback", () => {
  it("resolveMessageIds includes platform_message_memory message_row_id values", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "platform", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    const platformId = `pmm-${randomUUID().slice(0, 8)}`;
    const content = "platform batch24";
    const canonicalHash = createHash("sha256").update(content).digest("hex");
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-01-01T00:00:00Z', ?, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run(platformId, `dedupe-${platformId}`, content, canonicalHash, messageId);
    const identity = buildCanonicalIdentity(content, "message", "ingress", "platform", {
      tenantId: "default-tenant",
      canonicalHash,
    });
    identity.derivatives = [
      {
        storeId: "platform",
        sourceHash: identity.canonicalHash,
        provenance: "test",
        metadata: { message_id: messageId },
      },
    ];
    const adapter = getErasureStoreAdapter("platform");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("platform_message_memory_redacted");
  });

  it("traverseIndirectDerivatives adds implicit cache/context neighbor links", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`implicit-${randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const links = traverseIndirectDerivatives(database, identity);
    expect(links.filter((l) => l.storeId === "cache")).toHaveLength(1);
    expect(links.filter((l) => l.storeId === "context")).toHaveLength(1);
    expect(links.every((l) => l.provenance === "implicit_neighbor_link")).toBe(true);
  });

  it("vector adapter counts purged rows when local embedding delete succeeds", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "emb", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO message_embeddings (message_id, model, dim, vector) VALUES (?, ?, ?, ?)`)
      .run(messageId, "test-model", 1, Buffer.from(new Float32Array([1]).buffer));
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    registerEmbeddingProvenance(database, {
      canonicalId: identity.id,
      storeId: "vector",
      sourceHash: identity.canonicalHash,
      modelId: "m-b24",
      provenance: "batch24",
      metadata: { message_id: messageId },
    });
    const adapter = getErasureStoreAdapter("vector");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toMatch(/embedding_removed:1/);
  });

  it("coordinateErasure persists when memory_erasure_reports table is missing", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_erasure_reports");
    const identity = buildCanonicalIdentity(`no-report-${randomUUID()}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `er-fallback-${randomUUID()}`,
    });
    expect(report.erasureId).toBeTruthy();
    expect(report.storeOutcomes.length).toBeGreaterThan(0);
  });
});
