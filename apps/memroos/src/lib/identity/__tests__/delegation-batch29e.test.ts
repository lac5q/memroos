// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildDelegationChain } from "../delegation";

describe("delegation batch29e — early exits + readParentAgentId", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("returns null for empty userId/agentId and sub-agent mismatch paths", () => {
    db = new Database(":memory:");
    initSchema(db);

    expect(buildDelegationChain(db, "", "ag-1")).toBeNull();
    expect(buildDelegationChain(db, "usr-1", "")).toBeNull();

    const tenantId = "tenant-b29e";
    const userId = `usr-b29e-${crypto.randomUUID().slice(0, 8)}`;
    const agentId = `ag-parent-${crypto.randomUUID().slice(0, 8)}`;
    const subId = `ag-sub-${crypto.randomUUID().slice(0, 8)}`;
    const ts = new Date().toISOString();

    db.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).run(tenantId, "Tenant B29E");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, `${userId}@batch29e.test`, "Batch29e User", "x", tenantId, ts);

    db.prepare(
      `INSERT INTO registered_agents
        (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
       VALUES (?, 'Parent', 'agent', 'codex', 'rest', 'dormant', 'local', ?, '{}', ?, ?)`,
    ).run(agentId, userId, ts, ts);

    db.prepare(
      `INSERT INTO registered_agents
        (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
       VALUES (?, 'Sub', 'agent', 'codex', 'rest', 'dormant', 'local', ?, ?, ?, ?)`,
    ).run(subId, userId, JSON.stringify({ parent_agent_id: "other-parent" }), ts, ts);

    expect(buildDelegationChain(db, userId, agentId, subId)).toBeNull();

    db.prepare(`UPDATE registered_agents SET metadata = ? WHERE id = ?`).run(
      JSON.stringify({ parent_agent_id: agentId }),
      subId,
    );
    const otherUser = `usr-other-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(otherUser, `${otherUser}@batch29e.test`, "Other", "x", tenantId, ts);
    db.prepare(`UPDATE registered_agents SET owner_id = ? WHERE id = ?`).run(otherUser, subId);

    expect(buildDelegationChain(db, userId, agentId, subId)).toBeNull();
  });
});
