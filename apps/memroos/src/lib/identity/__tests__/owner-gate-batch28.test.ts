// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { onboardUser } from "@/lib/identity/lifecycle";
import { checkOwnerGate, grantPerUseApproval } from "../owner-gate";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedOwner(database: Database.Database, suffix: string): { ownerId: string; agentA: string; agentB: string } {
  const space = createSpace(database, { tenantId: "default-tenant", name: `gate-b28-${suffix}` });
  const owner = onboardUser(database, {
    email: `owner-b28-${suffix}@example.com`,
    displayName: `Owner ${suffix}`,
    role: "operator",
    spaceIds: [space.id],
    agentKit: { name: `owner-agent-${suffix}` },
  });
  const agentA = `agt_b28_a_${suffix}`;
  const agentB = `agt_b28_b_${suffix}`;
  const ts = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO registered_agents
       (id, name, role, platform, protocol, status, location, metadata, created_at, updated_at)
     VALUES (?, ?, 'agent', 'memroos', 'local', 'dormant', 'local', '{}', ?, ?)`,
  );
  insert.run(agentA, agentA, ts, ts);
  insert.run(agentB, agentB, ts, ts);
  return { ownerId: owner.userId, agentA, agentB };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("owner-gate batch28 — checkOwnerGate decisions", () => {
  it("allows standing approvals for any requesting agent", () => {
    const database = freshDb();
    const suffix = crypto.randomUUID().slice(0, 8);
    const { ownerId, agentA, agentB } = seedOwner(database, suffix);
    const assetId = `asset-standing-b28-${suffix}`;
    database
      .prepare(
        `INSERT INTO owner_gate_approvals
           (tenant_id, owner_id, asset_type, asset_id, approval_mode, agent_id, created_at)
         VALUES ('default-tenant', ?, 'memory', ?, 'standing', NULL, ?)`,
      )
      .run(ownerId, assetId, new Date().toISOString());

    const decision = checkOwnerGate(database, {
      ownerId,
      assetType: "memory",
      assetId,
      requestingAgentId: agentB,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.approvalMode).toBe("standing");
    expect(agentA).toBeTruthy();
  });

  it("denies agents without per-use approval and allows the approved agent", () => {
    const database = freshDb();
    const suffix = crypto.randomUUID().slice(0, 8);
    const { ownerId, agentA, agentB } = seedOwner(database, suffix);
    const assetId = `asset-peruse-b28-${suffix}`;

    const denied = checkOwnerGate(database, {
      ownerId,
      assetType: "memory",
      assetId,
      requestingAgentId: agentB,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.approvalMode).toBe("none");

    grantPerUseApproval(database, {
      ownerId,
      assetType: "memory",
      assetId,
      agentId: agentA,
    });
    const allowed = checkOwnerGate(database, {
      ownerId,
      assetType: "memory",
      assetId,
      requestingAgentId: agentA,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.approvalMode).toBe("per-use");
  });
});
