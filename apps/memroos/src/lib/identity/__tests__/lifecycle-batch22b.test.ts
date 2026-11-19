// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { offboardUser, onboardUser, scanOrphanedAgents } from "../lifecycle";

describe("identity lifecycle batch22b — validation and orphan scan merge", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
  });

  afterEach(() => {
    db.close();
  });

  it("onboardUser rejects empty displayName", () => {
    expect(() =>
      onboardUser(db, {
        email: "ops@example.com",
        displayName: "   ",
        role: "operator",
        spaceIds: [],
        agentKit: { name: "Kit" },
      }),
    ).toThrow(/displayName is required/);
  });

  it("onboardUser skips duplicate space memberships for human and agent", () => {
    const spaceId = `spc-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO spaces (id, tenant_id, name) VALUES (?, 'default-tenant', ?)`).run(spaceId, spaceId);
    const first = onboardUser(db, {
      email: `u1-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "User One",
      role: "operator",
      spaceIds: [spaceId, spaceId, ""],
      agentKit: { name: "Agent One", capabilities: [{ id: "", name: "skip-me" }] },
    });
    const second = onboardUser(db, {
      email: `u2-${crypto.randomUUID().slice(0, 6)}@example.com`,
      displayName: "User Two",
      role: "reviewer",
      spaceIds: [spaceId],
      agentKit: { name: "Agent Two" },
    });
    expect(first.spaceIds).toEqual([spaceId, spaceId, ""]);
    expect(second.agentId).not.toBe(first.agentId);
    const humanMembers = db
      .prepare(`SELECT COUNT(*) AS c FROM space_members WHERE space_id = ? AND member_type = 'human'`)
      .get(spaceId) as { c: number };
    expect(humanMembers.c).toBe(2);
  });

  it("offboardUser rejects blank userId", () => {
    expect(() => offboardUser(db, "   ")).toThrow(/userId is required/);
  });

  it("scanOrphanedAgents merges and sorts orphaned agents stably", () => {
    const ownerId = `usr-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, ?, ?, 'hash', 'default-tenant', datetime('now'))`,
    ).run(ownerId, `${ownerId}@example.com`, "Owner");
    const agentA = `agt-a-${crypto.randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO registered_agents (id, name, role, platform, protocol, status, owner_id, deregistered_at, created_at, updated_at)
       VALUES (?, 'A', 'worker', 'memroos', 'local', 'dormant', NULL, ?, ?, ?)`,
    ).run(agentA, now, now, now);
    db.prepare(
      `INSERT INTO agent_api_keys (agent_id, key_prefix, key_hash, created_at)
       VALUES (?, 'ak_live', ?, ?)`,
    ).run(agentA, crypto.randomUUID(), now);
    const orphans = scanOrphanedAgents(db);
    expect(orphans.map((o) => o.agentId)).toEqual([...orphans.map((o) => o.agentId)].sort());
    expect(orphans.some((o) => o.agentId === agentA)).toBe(true);
  });
});
