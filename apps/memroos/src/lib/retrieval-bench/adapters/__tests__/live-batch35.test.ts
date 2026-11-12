// @vitest-environment node
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy } from "../live";

const baseScope = {
  tenantId: "tenant-b35",
  userId: "user-b35",
  agentId: "agent-b35",
  spaceId: "space-b35",
  label: { visibility: "private" as const, policy: "agent_visible" as const, domain: null, sensitivity: null },
  purpose: "memory_search" as const,
  beliefStage: "silver_candidate_claim" as const,
  maxFreshnessSeconds: null,
};

const baseCandidate = {
  id: "cand-b35",
  timestamp_iso: "2026-11-12T00:00:00.000Z",
  scope: baseScope,
};

describe("retrieval-bench live adapter batch35", () => {
  it("normalizeRequesterScope denies when scope normalizes to invalid_scope (106)", () => {
    const decision = evaluateLivePolicy({
      task: { id: "t-b35", abstention_correct: false, corpus: [] } as never,
      scope: { ...baseScope, beliefStage: "not-a-stage" },
      candidate: baseCandidate,
    });
    expect(decision).toEqual({ kind: "deny", reason: "invalid_scope" });
  });

  it("evaluateLivePolicy denies malformed candidate scope (150)", () => {
    const decision = evaluateLivePolicy({
      task: { id: "t-b35b", abstention_correct: false, corpus: [] } as never,
      scope: baseScope,
      candidate: {
        id: "c-b35",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: { ...baseScope, label: { visibility: "nope", policy: "agent_visible" } },
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "candidate_scope_malformed" });
  });
});
