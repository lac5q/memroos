// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch36 — graph, report parse guards, messageId metadata", () => {
  it("graph adapter returns not_linked when identity has no graph derivative (575-577)", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`graph-b36-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch36" }];
    const adapter = getErasureStoreAdapter("graph");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-graph-b36-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked:graph");
  });

  it("traverseIndirectDerivatives ignores prior outcomes without string storeId (285)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`nostore-b36-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'operator-b36', ?, ?, ?)`,
      )
      .run(
        `rep-b36-${randomUUID().slice(0, 8)}`,
        identity.id,
        JSON.stringify([{ storeId: 42, status: "purged" }, { status: "tombstoned" }]),
        "scope-b36",
        "2026-03-06T00:00:00.000Z",
        "2026-03-06T00:00:01.000Z",
      );
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.filter((d) => d.provenance === "erasure_report_snapshot")).toHaveLength(0);
  });

  it("resolveMessageIds honors camelCase messageId metadata (434-437)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b36-${randomUUID()}`, "alpha", "agent", "user", "camel b36", "2026-03-06T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-06T00:00:00.000Z', 'agent')`)
      .run(messageId, "camel fts b36");
    const identity = buildCanonicalIdentity(`camel-b36-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch36",
        metadata: { messageId: String(messageId) },
      },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-camel-b36-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.metadata?.message_ids).toContain(messageId);
  });

  it("fts reports not_linked when table missing and identity not linked to fts (586-589)", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS messages_fts");
    const identity = buildCanonicalIdentity(`nofts-b36-${randomUUID().slice(0, 8)}`, "message", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vault", sourceHash: identity.canonicalHash, provenance: "batch36" }];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-nofts-b36-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.reason).toBe("fts_table_missing");
  });
});
