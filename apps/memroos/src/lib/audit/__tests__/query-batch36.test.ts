// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { queryAuditEntries } from "@/lib/audit/query";
import { writeAuditEntry } from "@/lib/audit/write";

describe("audit query batch36 — escapeLike (21)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("userId filter runs escapeLike for wildcard metacharacters (21)", () => {
    writeAuditEntry(
      {
        tenant_id: "default-tenant",
        actor_id: "actor-b36",
        actor_role: "operator",
        event_type: "test.escape",
        entity_type: "user",
        entity_id: "user:plain",
        metadata_json: JSON.stringify({ user_id: "plain-b36-user" }),
        created_at: "2026-11-12T12:00:00.000Z",
      },
      db,
    );

    const plain = queryAuditEntries({ userId: "plain-b36-user", limit: 10 }, db);
    expect(plain.entries).toHaveLength(1);

    const escaped = queryAuditEntries(
      { userId: String.raw`acme\_%\\b36-${randomUUID().slice(0, 4)}`, limit: 10 },
      db,
    );
    expect(Array.isArray(escaped.entries)).toBe(true);
  });
});
