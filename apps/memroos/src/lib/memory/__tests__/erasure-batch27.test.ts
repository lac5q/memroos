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

describe("erasure batch27 — fts purge success, qmd tombstone, embedding purge loop", () => {
  it("fts adapter deletes indexed rows when backing message still exists", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "fts-b27", "2026-01-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(
        `INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id)
         VALUES (?, ?, 'alpha', '2026-01-01T00:00:00.000Z', 'agent')`,
      )
      .run(messageId, "fts batch27 indexed");
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch27", metadata: { message_id: messageId } },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toMatch(/fts/);
  });

  it("qmd adapter tombstones linked canonical derivatives", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`qmd-${randomUUID().slice(0, 8)}`, "document", "ingress", "qmd", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "qmd", sourceHash: identity.canonicalHash, provenance: "batch27" }];
    const adapter = getErasureStoreAdapter("qmd");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-qmd-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("qmd_index_tombstoned");
  });

});
