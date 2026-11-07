// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { onboardUser } from "@/lib/identity/lifecycle";
import {
  grantPerUseApproval,
  revokeOwnerGateApproval,
} from "../owner-gate";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedOwner(database: Database.Database, suffix: string): { ownerId: string; agentA: string } {
  const space = createSpace(database, { tenantId: "default-tenant", name: `gate-b27-${suffix}` });
  const owner = onboardUser(database, {
    email: `owner-b27-${suffix}@example.com`,
    displayName: `Owner ${suffix}`,
    role: "operator",
    spaceIds: [space.id],
    agentKit: { name: `owner-agent-${suffix}` },
  });
  const agentA = `agt_b27_${suffix}`;
  const ts = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO registered_agents
         (id, name, role, platform, protocol, status, location, metadata, created_at, updated_at)
       VALUES (?, ?, 'agent', 'memroos', 'local', 'dormant', 'local', '{}', ?, ?)`,
    )
    .run(agentA, agentA, ts, ts);
  return { ownerId: owner.userId, agentA };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("owner-gate batch27 — validation and revoke filters", () => {
  it("grantPerUseApproval requires ownerId and assetType", () => {
    const database = freshDb();
    const suffix = crypto.randomUUID().slice(0, 8);
    const { ownerId, agentA } = seedOwner(database, suffix);
    expect(() =>
      grantPerUseApproval(database, {
        ownerId: "",
        assetType: "memory",
        assetId: "asset",
        agentId: agentA,
      }),
    ).toThrow(/ownerId is required/);
    expect(() =>
      grantPerUseApproval(database, {
        ownerId,
        assetType: "",
        assetId: "asset",
        agentId: agentA,
      }),
    ).toThrow(/assetType is required/);
  });

  it("revokeOwnerGateApproval validates required fields and supports agent_id IS NULL", () => {
    const database = freshDb();
    const suffix = crypto.randomUUID().slice(0, 8);
    const { ownerId } = seedOwner(database, suffix);
    const assetId = `asset-b27-${suffix}`;
    database
      .prepare(
        `INSERT INTO owner_gate_approvals
           (tenant_id, owner_id, asset_type, asset_id, approval_mode, agent_id, created_at)
         VALUES ('default-tenant', ?, 'memory', ?, 'standing', NULL, ?)`,
      )
      .run(ownerId, assetId, new Date().toISOString());

    expect(() =>
      revokeOwnerGateApproval(database, { ownerId: "", assetType: "memory", assetId }),
    ).toThrow(/ownerId, assetType, assetId are required/);

    const revoked = revokeOwnerGateApproval(database, {
      ownerId,
      assetType: "memory",
      assetId,
      agentId: null,
    });
    expect(revoked).toBe(1);
  });
});
