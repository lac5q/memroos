// @vitest-environment node
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy } from "../live";

const baseScope = {
  tenantId: "tenant-b35b",
  userId: "user-b35b",
  agentId: "agent-b35b",
  spaceId: "space-b35b",
  label: { visibility: "private" as const, policy: "agent_visible" as const, domain: null, sensitivity: null },
  purpose: "memory_search" as const,
  beliefStage: "silver_candidate_claim" as const,
  maxFreshnessSeconds: null,
};

describe("retrieval-bench live adapter batch35b", () => {
  it("normalizeRequesterScope denies when normalizeScopeIdentity returns null (106)", () => {
    const decision = evaluateLivePolicy({
      task: { id: "t-b35b", abstention_correct: false, corpus: [] } as never,
      scope: { ...baseScope, tenantId: "" },
      candidate: {
        id: "c-b35b",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: baseScope,
      },
    });
    expect(decision.kind).toBe("deny");
    expect(["invalid_scope", "incomplete_scope"]).toContain(decision.reason);
  });

  it("evaluateLivePolicy denies malformed candidate scope after input issue passes (150)", () => {
    const decision = evaluateLivePolicy({
      task: { id: "t-b35b2", abstention_correct: false, corpus: [] } as never,
      scope: baseScope,
      candidate: {
        id: "c-b35b2",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: {
          ...baseScope,
          purpose: "not-a-purpose" as never,
        },
      },
    });
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toMatch(/candidate_scope_malformed|invalid_scope|purpose/);
  });
});
