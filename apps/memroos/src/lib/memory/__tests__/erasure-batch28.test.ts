// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter } from "../erasure";

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

describe("erasure batch28 — cache, candidates, message, salience, graph not linked", () => {
  it("cache adapter invalidates space_cache_state rows (lines 623-648)", async () => {
    const database = freshDb();
    database.prepare(`INSERT INTO spaces(id, tenant_id, name) VALUES ('space-b28', 'default-tenant', 'cache-space')`).run();
    const identity = buildCanonicalIdentity("cache target batch28", "message", "ingress", "cache", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO space_cache_state (space_id, resource_id, last_fetched, cached_size, retrieval_count, invalidated_at)
         VALUES ('space-b28', ?, '2026-01-01T00:00:00.000Z', 64, 3, NULL)`,
      )
      .run(identity.id);
    identity.derivatives = [{ storeId: "cache", sourceHash: identity.canonicalHash, provenance: "batch28" }];

    const adapter = getErasureStoreAdapter("cache");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-cache-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("cache_entries_invalidated");
  });

  it("candidates adapter tombstones agent_memory_candidates (lines 712-764)", async () => {
    const database = freshDb();
    const candidateId = `cand-b28-${randomUUID().slice(0, 8)}`;
    const captureId = `cap-b28-${randomUUID().slice(0, 6)}`;
    const contentHash = randomUUID().replace(/-/g, "");
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess-b28', ?, '2026-01-01T00:00:00.000Z')`,
      )
      .run(captureId, contentHash);
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent', 'lesson', 'secret candidate batch28', ?, 'candidate', '{}', '2026-01-01T00:00:00.000Z')`,
      )
      .run(candidateId, captureId, contentHash);

    const identity = buildCanonicalIdentity("secret candidate batch28", "candidate", "ingress", "candidates", {
      tenantId: "default-tenant",
    });
    (identity as { id: string }).id = candidateId;
    (identity as { canonicalHash: string }).canonicalHash = contentHash;
    identity.derivatives = [
      {
        storeId: "candidates",
        sourceHash: contentHash,
        provenance: "batch28",
        metadata: { candidate_id: candidateId },
      },
    ];

    const adapter = getErasureStoreAdapter("candidates");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-cand-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("candidate_rows_tombstoned");
  });

  it("message adapter redacts episodic payloads (lines 844-867)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "erase-me-b28", "2026-01-02T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;

    const identity = buildCanonicalIdentity("erase-me-b28", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "message",
        sourceHash: identity.canonicalHash,
        provenance: "batch28",
        metadata: { message_id: messageId },
      },
    ];

    const adapter = getErasureStoreAdapter("message");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-msg-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("message_payload_redacted");
    const row = database.prepare(`SELECT content FROM messages WHERE id = ?`).get(messageId) as { content: string };
    expect(row.content).toBe("[erased]");
  });

  it("salience adapter purges memory_salience rows (lines 881-898)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "salience-b28", "2026-01-03T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database.prepare(`INSERT INTO memory_salience (message_id, salience_score) VALUES (?, ?)`).run(messageId, 0.9);

    const identity = buildCanonicalIdentity("salience-b28", "message", "ingress", "salience", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "salience",
        sourceHash: identity.canonicalHash,
        provenance: "batch28",
        metadata: { message_id: messageId },
      },
    ];

    const adapter = getErasureStoreAdapter("salience");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-sal-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("memory_salience_rows_deleted");
  });

  it("graph adapter returns zero_match when graph derivative not linked (lines 575-577)", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`graph-b28-${randomUUID().slice(0, 8)}`, "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const adapter = getErasureStoreAdapter("graph");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-graph-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked:graph");
  });
});
