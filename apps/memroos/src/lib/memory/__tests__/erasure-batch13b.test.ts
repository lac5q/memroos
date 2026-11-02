// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { coordinateErasure, getErasureStoreAdapter } from "@/lib/memory/erasure";

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

describe("erasure batch13b — store adapter edge paths", () => {
  it("graph adapter reports neo4j_not_configured when graph is linked", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("graph cfg", "message", "ingress", "graph", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "graph", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("graph");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.reason).toBe("neo4j_not_configured");
  });

  it("context adapter tombstones matching agent_handoff_packs", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("ctx-pack", "context", "ingress", "context", {
      tenantId: "default-tenant",
    });
    const packId = `pack-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO agent_handoff_packs
         (id, tenant_id, session_id, task_id, title, status, context_pack_json, source_capture_ids_json)
         VALUES (?, 'default-tenant', ?, ?, 'handoff', 'ready', ?, '[]')`
      )
      .run(packId, identity.id, identity.id, JSON.stringify({ canonical_id: identity.id }));
    identity.derivatives = [{ storeId: "context", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("context");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("context_packs_expired_redacted");
  });

  it("qmd adapter tombstones when qmd derivative is linked", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("qmd doc", "document", "ingress", "qmd", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "qmd", sourceHash: identity.canonicalHash, provenance: "test" }];
    const adapter = getErasureStoreAdapter("qmd");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("qmd_index_tombstoned");
  });

  it("cache adapter reports not_linked when cache derivative absent", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no cache", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const adapter = getErasureStoreAdapter("cache");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked:cache");
  });

  it("coordinateErasure rejects when scope tenant mismatches canonical tenant", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("tenant gate", "message", "ingress", "message", {
      tenantId: "tenant-a",
    });
    await expect(
      coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "tenant-b" },
      })
    ).rejects.toMatchObject({ code: "wrong_tenant" });
  });

  it("platform adapter redacts platform_message_memory rows", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);
    const identity = buildCanonicalIdentity("platform redact", "platform", "ingress", "platform", {
      tenantId: "default-tenant",
    });
    const platformId = `plat-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-01-01T00:00:00Z', '{}', ?, ?)`
      )
      .run(
        platformId,
        `dedupe-${platformId}`,
        "platform redact",
        identity.canonicalHash,
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z"
      );
    identity.derivatives = [{ storeId: "platform", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const platform = report.storeOutcomes.find((o) => o.storeId === "platform");
    expect(platform?.status).toBe("tombstoned");
    expect(platform?.reason).toBe("platform_message_memory_redacted");
  });
});
