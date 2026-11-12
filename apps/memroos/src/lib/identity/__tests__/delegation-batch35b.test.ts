// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildDelegationChain } from "../delegation";

describe("delegation batch35b", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("readParentAgentId returns null for missing metadata (103) and rejects missing sub-agent (159)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const tenantId = "tenant-b35b";
    const userId = `usr-b35b-${randomUUID().slice(0, 8)}`;
    const agentId = `ag-parent-${randomUUID().slice(0, 8)}`;
    const subId = `ag-sub-${randomUUID().slice(0, 8)}`;
    const ghostSub = `ag-ghost-${randomUUID().slice(0, 8)}`;
    const ts = new Date().toISOString();

    db.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).run(tenantId, "Tenant B35B");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, `${userId}@batch35b.test`, "User", "x", tenantId, ts);

    db.prepare(
      `INSERT INTO registered_agents
        (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
       VALUES (?, 'Parent', 'agent', 'codex', 'rest', 'dormant', 'local', ?, '{}', ?, ?)`,
    ).run(agentId, userId, ts, ts);

    db.prepare(
      `INSERT INTO registered_agents
        (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
       VALUES (?, 'Sub', 'agent', 'codex', 'rest', 'dormant', 'local', ?, '', ?, ?)`,
    ).run(subId, userId, ts, ts);

    expect(buildDelegationChain(db, userId, agentId, subId)).toBeNull();
    expect(buildDelegationChain(db, userId, agentId, ghostSub)).toBeNull();
  });
});
