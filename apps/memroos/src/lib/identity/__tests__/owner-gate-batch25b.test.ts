// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { onboardUser } from "@/lib/identity/lifecycle";
import {
  checkOwnerGate,
  grantPerUseApproval,
  listOwnerGateApprovals,
  revokeOwnerGateApproval,
} from "../owner-gate";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedOwner(database: Database.Database, suffix: string): { ownerId: string; agentA: string; agentB: string } {
  const space = createSpace(database, { tenantId: "default-tenant", name: `gate-b25b-${suffix}` });
  const owner = onboardUser(database, {
    email: `owner-${suffix}@example.com`,
    displayName: `Owner ${suffix}`,
    role: "operator",
    spaceIds: [space.id],
    agentKit: { name: `owner-agent-${suffix}` },
  });
  const agentA = `agt_a_${suffix}`;
  const agentB = `agt_b_${suffix}`;
  const ts = new Date().toISOString();
  for (const agentId of [agentA, agentB]) {
    database
      .prepare(
        `INSERT INTO registered_agents
           (id, name, role, platform, protocol, status, location, metadata, created_at, updated_at)
         VALUES (?, ?, 'agent', 'memroos', 'local', 'dormant', 'local', '{}', ?, ?)`,
      )
      .run(agentId, agentId, ts, ts);
  }
  return { ownerId: owner.userId, agentA, agentB };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("owner-gate batch25b — per-use denial and listing", () => {
  it("per-use approval allows only the authorized agent", () => {
    const database = freshDb();
    const suffix = crypto.randomUUID().slice(0, 8);
    const { ownerId, agentA, agentB } = seedOwner(database, suffix);
    const assetId = `asset-${suffix}`;
    grantPerUseApproval(database, {
      ownerId,
      assetType: "memory",
      assetId,
      agentId: agentA,
    });
    const allowed = checkOwnerGate(database, {
      assetType: "memory",
      assetId,
      requestingAgentId: agentA,
      ownerId,
    });
    const denied = checkOwnerGate(database, {
      assetType: "memory",
      assetId,
      requestingAgentId: agentB,
      ownerId,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.approvalMode).toBe("per-use");
    expect(denied.allowed).toBe(false);
    expect(denied.approvalMode).toBe("none");
  });

  it("listOwnerGateApprovals omits revoked approvals", () => {
    const database = freshDb();
    const suffix = crypto.randomUUID().slice(0, 8);
    const { ownerId, agentA } = seedOwner(database, suffix);
    const assetId = `asset-list-${suffix}`;
    grantPerUseApproval(database, {
      ownerId,
      assetType: "skill",
      assetId,
      agentId: agentA,
    });
    expect(
      listOwnerGateApprovals(database, { ownerId, assetType: "skill", assetId }).length,
    ).toBe(1);
    revokeOwnerGateApproval(database, {
      ownerId,
      assetType: "skill",
      assetId,
      agentId: agentA,
    });
    expect(
      listOwnerGateApprovals(database, { ownerId, assetType: "skill", assetId }).length,
    ).toBe(0);
  });
});
