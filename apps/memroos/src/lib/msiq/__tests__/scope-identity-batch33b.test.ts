// @vitest-environment node
import { describe, expect, it } from "vitest";

import { hashScopeIdentity, isCompleteScopeIdentity, normalizeScopeIdentity } from "../scope-identity";

describe("msiq scope-identity batch33b", () => {
  it("isCompleteScopeIdentity rejects string labels and partial visibility/policy (116)", () => {
    expect(isCompleteScopeIdentity({ tenantId: "t", label: "batch33b-string-label" })).toBe(false);
    expect(
      isCompleteScopeIdentity({
        tenantId: "t",
        userId: "u",
        agentId: "a",
        spaceId: "s",
        label: { visibility: "private" },
        purpose: "memory_search",
        beliefStage: "silver_candidate_claim",
      }),
    ).toBe(false);
  });

  it("hashScopeIdentity canonicalizes sorted object keys (normalizeStable 216)", () => {
    const scope = normalizeScopeIdentity({
      tenantId: "tenant-b33b",
      userId: "user-b33b",
      agentId: "agent-b33b",
      spaceId: "space-b33b",
      label: { visibility: "private", policy: "agent_visible", domain: "ops" },
      purpose: "memory_search",
      beliefStage: "silver_candidate_claim",
    });
    expect(scope).not.toBeNull();
    const forward = hashScopeIdentity(scope!);
    const shuffledInput = {
      beliefStage: "silver_candidate_claim",
      purpose: "memory_search",
      spaceId: "space-b33b",
      agentId: "agent-b33b",
      userId: "user-b33b",
      tenantId: "tenant-b33b",
      label: { policy: "agent_visible", visibility: "private", domain: "ops" },
    };
    const fromShuffle = normalizeScopeIdentity(shuffledInput);
    expect(hashScopeIdentity(fromShuffle!)).toBe(forward);
  });
});
