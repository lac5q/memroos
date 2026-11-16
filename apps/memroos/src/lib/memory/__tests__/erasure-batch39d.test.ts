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

describe("erasure batch39d", () => {
  it("purgeFtsRows continues when messages row is missing but fts index exists (503)", async () => {
    const database = freshDb();
    const orphanId = 900_039;
    const identity = buildCanonicalIdentity(`orphan-fts-b39d-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id)
         VALUES (?, ?, 'alpha', '2026-11-16T00:00:00.000Z', 'agent-b39d')`,
      )
      .run(orphanId, "orphan fts b39d");

    const liveId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        `sess-b39d-${randomUUID()}`,
        "alpha",
        "agent-b39d",
        "user",
        "live fts b39d",
        "2026-11-16T00:00:00.000Z",
        "internal",
        "indexable",
      ).lastInsertRowid as number;
    database
      .prepare(
        `INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id)
         VALUES (?, ?, 'alpha', '2026-11-16T00:00:00.000Z', 'agent-b39d')`,
      )
      .run(liveId, "live fts b39d");

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
      actorId: "operator-b39d",
      createdAt: "2026-11-16T00:00:00.000Z",
      now: new Date("2026-11-16T00:00:00.000Z"),
    });

    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch39d",
        metadata: { message_id: orphanId },
      },
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch39d",
        metadata: { message_id: liveId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-b39d-${randomUUID()}`,
      actorId: "operator-b39d",
      reason: "batch39d fts purge",
    });
    expect(outcome.status).toBe("purged");
  });
});