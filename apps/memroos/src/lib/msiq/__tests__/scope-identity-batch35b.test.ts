// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { hashScopeIdentity, isCompleteScopeIdentity, normalizeScopeIdentity } from "../scope-identity";

describe("msiq scope-identity batch35b", () => {
  it("isCompleteScopeIdentity rejects non-object labels (116)", () => {
    expect(isCompleteScopeIdentity({ tenantId: "t", label: 42 })).toBe(false);
    expect(
      isCompleteScopeIdentity({
        tenantId: "t",
        userId: "u",
        agentId: "a",
        spaceId: "s",
        label: { visibility: "private", policy: 9 },
        purpose: "memory_search",
        beliefStage: "silver_candidate_claim",
      }),
    ).toBe(false);
  });

  it("hashScopeIdentity sorts nested keys via normalizeStable (216)", () => {
    const scope = normalizeScopeIdentity({
      tenantId: `tenant-b35b-${randomUUID().slice(0, 6)}`,
      userId: "user-b35b",
      agentId: "agent-b35b",
      spaceId: "space-b35b",
      label: { visibility: "internal", policy: "indexable", domain: "z", sensitivity: "low" },
      purpose: "memory_search",
      beliefStage: "silver_candidate_claim",
    });
    expect(scope).not.toBeNull();
    const nestedForward = hashScopeIdentity(scope!);
    const reshaped = normalizeScopeIdentity({
      beliefStage: "silver_candidate_claim",
      purpose: "memory_search",
      spaceId: "space-b35b",
      agentId: "agent-b35b",
      userId: "user-b35b",
      tenantId: scope!.tenantId,
      label: { sensitivity: "low", domain: "z", policy: "indexable", visibility: "internal" },
    });
    expect(hashScopeIdentity(reshaped!)).toBe(nestedForward);
  });
});
