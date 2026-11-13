// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { hashScopeIdentity, isCompleteScopeIdentity, normalizeScopeIdentity } from "../scope-identity";

const completeButBadLabel = {
  tenantId: `tenant-b36-${randomUUID().slice(0, 6)}`,
  userId: "user-b36",
  agentId: "agent-b36",
  spaceId: "space-b36",
  label: null,
  purpose: "memory_search",
  beliefStage: "silver_candidate_claim",
} as const;

describe("msiq scope-identity batch36", () => {
  it("isCompleteScopeIdentity hits isRecord(label) guard when label is not an object (116)", () => {
    expect(isCompleteScopeIdentity(completeButBadLabel)).toBe(false);
    expect(
      isCompleteScopeIdentity({
        tenantId: "t-b36",
        userId: "u-b36",
        agentId: "a-b36",
        spaceId: "s-b36",
        label: ["not", "a", "record"],
        purpose: "memory_search",
        beliefStage: "silver_candidate_claim",
      }),
    ).toBe(false);
  });

  it.skip("normalizeStable array branch in scope-identity.ts (216) is unreachable via hashScopeIdentity — canonical scope has no arrays", () => {});

  it("hashScopeIdentity still stable for reordered label keys", () => {
    const scope = normalizeScopeIdentity({
      tenantId: `tenant-b36-hash-${randomUUID().slice(0, 6)}`,
      userId: "user-b36",
      agentId: "agent-b36",
      spaceId: "space-b36",
      label: { visibility: "internal", policy: "indexable", domain: "z", sensitivity: "low" },
      purpose: "memory_search",
      beliefStage: "silver_candidate_claim",
    });
    expect(scope).not.toBeNull();
    const forward = hashScopeIdentity(scope!);
    const reshaped = normalizeScopeIdentity({
      beliefStage: "silver_candidate_claim",
      purpose: "memory_search",
      spaceId: "space-b36",
      agentId: "agent-b36",
      userId: "user-b36",
      tenantId: scope!.tenantId,
      label: { sensitivity: "low", domain: "z", policy: "indexable", visibility: "internal" },
    });
    expect(hashScopeIdentity(reshaped!)).toBe(forward);
  });
});
