// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  buildDelegationChain,
  verifyDelegationChain,
  weakestLinkOutcome,
  type DelegationChain,
} from "@/lib/identity/delegation";
import { onboardUser } from "@/lib/identity/lifecycle";
import { createSpace } from "@/lib/space";

describe("identity delegation batch20c", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("weakestLinkOutcome denies when hop outcomes are shorter than chain hops", () => {
    const chain: DelegationChain = {
      user: { id: "u1", role: "operator" },
      agent: { id: "a1", capabilities: ["memory_search"] },
      hops: [
        {
          fromId: "u1",
          fromType: "user",
          toId: "a1",
          toType: "agent",
          capabilities: ["memory_search"],
        },
      ],
    };
    expect(weakestLinkOutcome(chain, [])).toBe("deny");
    expect(weakestLinkOutcome(chain, [{ hopIndex: 0, outcome: "allow" }])).toBe("allow");
    expect(
      weakestLinkOutcome(chain, [{ hopIndex: 0, outcome: "deny" }]),
    ).toBe("deny");
  });

  it("verifyDelegationChain rejects invalid first hop wiring", () => {
    const bad: DelegationChain = {
      user: { id: "u1", role: "operator" },
      agent: { id: "a1", capabilities: ["x"] },
      hops: [
        {
          fromId: "other-user",
          fromType: "user",
          toId: "a1",
          toType: "agent",
          capabilities: ["x"],
        },
      ],
    };
    expect(verifyDelegationChain(bad)).toEqual({ valid: false, reason: "invalid_first_hop" });
  });

  it("buildDelegationChain returns null when parent metadata does not match agent", () => {
    const team = createSpace(db, {
      tenantId: "default-tenant",
      name: `Team-${crypto.randomUUID().slice(0, 6)}`,
    });
    const owner = onboardUser(db, {
      email: `owner-${crypto.randomUUID()}@example.com`,
      displayName: "Owner",
      role: "operator",
      spaceIds: [team.id],
      agentKit: { name: "Parent Agent", skills: [], capabilities: [{ id: "memory_search" }] },
    });
    const ts = new Date().toISOString();
    const subId = `agent_sub_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO registered_agents
         (id, name, role, platform, protocol, status, location, owner_id, metadata, created_at, updated_at)
       VALUES (?, 'Sub', 'worker', 'memroos', 'local', 'active', 'local', ?, ?, ?, ?)`,
    ).run(subId, owner.userId, JSON.stringify({ parent_agent_id: "wrong-parent" }), ts, ts);
    db.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description) VALUES (?, ?, ?, ?)`,
    ).run(subId, "memory_search", "Memory search", "");
    expect(buildDelegationChain(db, owner.userId, owner.agentId, subId)).toBeNull();
  });
});
