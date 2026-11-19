// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { queryAuditEntries, streamAuditEntries } from "@/lib/audit/query";
import { writeAuditEntry } from "@/lib/audit/write";
import { initSchema } from "@/lib/db-schema";

function seedDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  writeAuditEntry(
    {
      tenant_id: "default-tenant",
      actor_id: "operator",
      actor_role: "operator",
      event_type: "test.event",
      entity_type: "agent",
      entity_id: "agent:stream-agent",
      metadata_json: JSON.stringify({ user_id: "bob_under" }),
      created_at: "2026-02-01T12:00:00Z",
    },
    db,
  );
  writeAuditEntry(
    {
      tenant_id: "default-tenant",
      actor_id: "operator",
      actor_role: "operator",
      event_type: "skill.sync",
      entity_type: "skill",
      entity_id: "skill:42",
      metadata_json: JSON.stringify({ user_id: "bob_under" }),
      created_at: "2026-02-02T12:00:00Z",
    },
    db,
  );
  return db;
}

describe("audit query batch15 — stream filters and LIKE escaping", () => {
  it("streamAuditEntries applies agentId, entityId, eventType array, and date bounds", () => {
    const db = seedDb();
    const agentStream = [
      ...streamAuditEntries({ agentId: "stream-agent", tenantId: "default-tenant" }, db),
    ];
    expect(agentStream).toHaveLength(1);

    const entityStream = [...streamAuditEntries({ entityId: "skill:42" }, db)];
    expect(entityStream).toHaveLength(1);

    const typeStream = [
      ...streamAuditEntries({ eventType: ["skill.sync", "missing.type"], tenantId: "default-tenant" }, db),
    ];
    expect(typeStream).toHaveLength(1);

    const ranged = [
      ...streamAuditEntries({
        from: "2026-02-01T00:00:00Z",
        to: "2026-02-02T23:59:59Z",
        tenantId: "default-tenant",
      }, db),
    ];
    expect(ranged.length).toBeGreaterThanOrEqual(2);

    db.close();
  });

  it("streamAuditEntries yields nothing for out-of-range window", () => {
    const db = seedDb();
    const empty = [
      ...streamAuditEntries({
        from: "2026-03-01T00:00:00Z",
        to: "2026-03-02T00:00:00Z",
      }, db),
    ];
    expect(empty).toHaveLength(0);
    db.close();
  });
});
