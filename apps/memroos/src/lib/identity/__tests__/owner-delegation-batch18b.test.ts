// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { onboardUser } from "@/lib/identity/lifecycle";
import { checkOwnerGate, grantPerUseApproval } from "../owner-gate";
import {
  buildDelegationChain,
  verifyDelegationChain,
  weakestLinkOutcome,
} from "../delegation";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedOwner(database: Database.Database, suffix: string): { ownerId: string; agentId: string } {
  const space = createSpace(database, { tenantId: "default-tenant", name: `gate-b18b-${suffix}` });
  const owner = onboardUser(database, {
    email: `owner-${suffix}@example.com`,
    displayName: `Owner ${suffix}`,
    role: "operator",
    spaceIds: [space.id],
    agentKit: { name: `owner-agent-${suffix}` },
  });
  const agentId = `agt_${suffix}`;
  const ts = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO registered_agents
         (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
       VALUES (?, ?, 'agent', 'memroos', 'local', 'active', 'local', ?, '{}', ?, ?)`,
    )
    .run(agentId, `agent-${suffix}`, owner.userId, ts, ts);
  database
    .prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description)
       VALUES (?, 'read', 'Read', '')`,
    )
    .run(agentId);
  return { ownerId: owner.userId, agentId };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("identity batch18b — owner gate + delegation", () => {
  it("checkOwnerGate denies when no approval rows exist", () => {
    const database = freshDb();
    const decision = checkOwnerGate(database, {
      assetType: "memory",
      assetId: "mem-1",
      requestingAgentId: "agent-1",
      ownerId: "owner-1",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.approvalMode).toBe("none");
  });

  it("buildDelegationChain returns null for corrupt parent metadata", () => {
    const database = freshDb();
    const { ownerId } = seedOwner(database, crypto.randomUUID().slice(0, 8));
    const ts = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO registered_agents
         (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
         VALUES ('parent-agent', 'Parent', 'agent', 'memroos', 'local', 'active', 'local', ?, '{}', ?, ?)`,
      )
      .run(ownerId, ts, ts);
    database
      .prepare(
        `INSERT INTO registered_agents
         (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
         VALUES ('sub-agent', 'Sub', 'agent', 'memroos', 'local', 'active', 'local', ?, ?, ?, ?)`,
      )
      .run(ownerId, "{bad-json", ts, ts);
    database
      .prepare(`INSERT INTO agent_capabilities (agent_id, capability_id, name, description) VALUES ('parent-agent', 'read', 'Read', '')`)
      .run();
    database
      .prepare(`INSERT INTO agent_capabilities (agent_id, capability_id, name, description) VALUES ('sub-agent', 'read', 'Read', '')`)
      .run();

    expect(buildDelegationChain(database, ownerId, "parent-agent", "sub-agent")).toBeNull();
  });

  it("weakestLinkOutcome denies when hop outcomes are incomplete", () => {
    const chain = {
      user: { id: "user-1", role: "operator" },
      agent: { id: "agent-1", capabilities: ["read"] },
      hops: [
        {
          fromId: "user-1",
          fromType: "user" as const,
          toId: "agent-1",
          toType: "agent" as const,
          capabilities: ["read"],
        },
      ],
    };
    expect(weakestLinkOutcome(chain, [])).toBe("deny");
    expect(verifyDelegationChain(chain).valid).toBe(true);
  });

  it("grantPerUseApproval allows only the authorized agent", () => {
    const database = freshDb();
    const { ownerId, agentId } = seedOwner(database, crypto.randomUUID().slice(0, 8));
    grantPerUseApproval(database, {
      ownerId,
      assetType: "skill",
      assetId: "skill-1",
      agentId,
    });
    const allowed = checkOwnerGate(database, {
      assetType: "skill",
      assetId: "skill-1",
      requestingAgentId: agentId,
      ownerId,
    });
    const denied = checkOwnerGate(database, {
      assetType: "skill",
      assetId: "skill-1",
      requestingAgentId: "agent-other",
      ownerId,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.approvalMode).toBe("per-use");
    expect(denied.allowed).toBe(false);
  });
});
