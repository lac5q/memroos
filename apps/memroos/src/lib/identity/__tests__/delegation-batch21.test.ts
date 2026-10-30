// @vitest-environment node
import { describe, expect, it } from "vitest";

import { verifyDelegationChain, type DelegationChain } from "@/lib/identity/delegation";

describe("identity delegation batch21", () => {
  it("verifyDelegationChain rejects missing agent and invalid sub-agent hops", () => {
    const missingAgent = {
      user: { id: "u1", role: "operator" },
      agent: { id: "", capabilities: ["memory_search"] },
      hops: [
        {
          fromId: "u1",
          fromType: "user" as const,
          toId: "a1",
          toType: "agent" as const,
          capabilities: ["memory_search"],
        },
      ],
    } satisfies DelegationChain;
    expect(verifyDelegationChain(missingAgent)).toEqual({ valid: false, reason: "missing_agent" });

    const invalidSubHop: DelegationChain = {
      user: { id: "u1", role: "operator" },
      agent: { id: "a1", capabilities: ["memory_search"] },
      subAgent: { id: "sub1", capabilities: ["memory_search"] },
      hops: [
        {
          fromId: "u1",
          fromType: "user",
          toId: "a1",
          toType: "agent",
          capabilities: ["memory_search"],
        },
        {
          fromId: "wrong-agent",
          fromType: "agent",
          toId: "sub1",
          toType: "sub-agent",
          capabilities: ["memory_search"],
        },
      ],
    };
    expect(verifyDelegationChain(invalidSubHop)).toEqual({ valid: false, reason: "invalid_subagent_hop" });

    const emptySubCaps: DelegationChain = {
      user: { id: "u1", role: "operator" },
      agent: { id: "a1", capabilities: ["memory_search"] },
      subAgent: { id: "sub1", capabilities: [] },
      hops: [
        {
          fromId: "u1",
          fromType: "user",
          toId: "a1",
          toType: "agent",
          capabilities: ["memory_search"],
        },
        {
          fromId: "a1",
          fromType: "agent",
          toId: "sub1",
          toType: "sub-agent",
          capabilities: [],
        },
      ],
    };
    expect(verifyDelegationChain(emptySubCaps)).toEqual({ valid: false, reason: "subagent_has_no_capabilities" });
  });
});
