// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerRetentionRecord } from "@/lib/memory/retention-policy";
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

describe("erasure batch35b — orphan FTS row continue (503)", () => {
  it("purgeFtsRows continues when messages row is missing but FTS row exists", async () => {
    const database = freshDb();
    const orphanId = 900_001;
    const identity = buildCanonicalIdentity(`orphan-fts-b35b-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-05T00:00:00.000Z', 'agent')`)
      .run(orphanId, "orphan fts b35b");

    const liveId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b35b-${randomUUID()}`, "alpha", "agent", "user", "live", "2026-03-05T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-05T00:00:00.000Z', 'agent')`)
      .run(liveId, "live fts b35b");

    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(liveId),
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        project: "alpha",
        canonicalMemoryId: identity.id,
      },
      contentHash: randomUUID(),
      actorId: "operator-b35b",
      createdAt: "2026-03-05T00:00:00.000Z",
      now: new Date("2026-03-05T00:00:00.000Z"),
    });

    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch35b",
        metadata: { message_id: orphanId },
      },
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch35b",
        metadata: { message_id: liveId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-b35b-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.metadata?.purged).toBeGreaterThanOrEqual(1);
  });
});
