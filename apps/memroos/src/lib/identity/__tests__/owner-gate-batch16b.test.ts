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
  grantStandingApproval,
  listOwnerGateApprovals,
  revokeOwnerGateApproval,
} from "../owner-gate";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedOwner(db: Database.Database, suffix: string): { ownerId: string; agentId: string } {
  const space = createSpace(db, { tenantId: "default-tenant", name: `gate-b16b-${suffix}` });
  const owner = onboardUser(db, {
    email: `owner-${suffix}@example.com`,
    displayName: `Owner ${suffix}`,
    role: "operator",
    spaceIds: [space.id],
    agentKit: { name: `owner-agent-${suffix}` },
  });
  const agentId = `agt_${suffix}`;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO registered_agents
       (id, name, role, platform, protocol, status, location, metadata, created_at, updated_at)
     VALUES (?, ?, 'agent', 'memroos', 'local', 'dormant', 'local', '{}', ?, ?)`,
  ).run(agentId, `agent-${suffix}`, ts, ts);
  return { ownerId: owner.userId, agentId };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("owner-gate batch16b — standing, per-use, revoke", () => {
  it("checkOwnerGate requires asset and agent identifiers", () => {
    const database = freshDb();
    expect(() =>
      checkOwnerGate(database, {
        assetType: "",
        assetId: "a1",
        requestingAgentId: "agent-1",
        ownerId: "owner-1",
      }),
    ).toThrow(/assetType and assetId are required/);
    expect(() =>
      checkOwnerGate(database, {
        assetType: "memory",
        assetId: "a1",
        requestingAgentId: "",
        ownerId: "owner-1",
      }),
    ).toThrow(/requestingAgentId is required/);
  });

  it("standing approval allows any agent until revoked", () => {
    const database = freshDb();
    const { ownerId, agentId } = seedOwner(database, crypto.randomUUID().slice(0, 8));
    const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
    grantStandingApproval(database, {
      ownerId,
      assetType: "memory",
      assetId,
    });
    const allowed = checkOwnerGate(database, {
      assetType: "memory",
      assetId,
      requestingAgentId: agentId,
      ownerId,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.approvalMode).toBe("standing");

    revokeOwnerGateApproval(database, {
      ownerId,
      assetType: "memory",
      assetId,
    });
    const denied = checkOwnerGate(database, {
      assetType: "memory",
      assetId,
      requestingAgentId: agentId,
      ownerId,
    });
    expect(denied.allowed).toBe(false);
    expect(
      listOwnerGateApprovals(database, {
        ownerId,
        assetType: "memory",
        assetId,
      }),
    ).toHaveLength(0);
  });

  it("per-use approval only passes for the authorized agent", () => {
    const database = freshDb();
    const { ownerId, agentId } = seedOwner(database, crypto.randomUUID().slice(0, 8));
    const otherSuffix = crypto.randomUUID().slice(0, 8);
    const otherAgent = `agt_other_${otherSuffix}`;
    const ts = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO registered_agents
         (id, name, role, platform, protocol, status, location, metadata, created_at, updated_at)
         VALUES (?, 'other', 'agent', 'memroos', 'local', 'dormant', 'local', '{}', ?, ?)`,
      )
      .run(otherAgent, ts, ts);
    const assetId = `asset-per-${crypto.randomUUID().slice(0, 8)}`;
    grantPerUseApproval(database, {
      ownerId,
      assetType: "skill",
      assetId,
      agentId,
    });
    const ok = checkOwnerGate(database, {
      assetType: "skill",
      assetId,
      requestingAgentId: agentId,
      ownerId,
    });
    const blocked = checkOwnerGate(database, {
      assetType: "skill",
      assetId,
      requestingAgentId: otherAgent,
      ownerId,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.approvalMode).toBe("per-use");
    expect(blocked.allowed).toBe(false);
  });
});
