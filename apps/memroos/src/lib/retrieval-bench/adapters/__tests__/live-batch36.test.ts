// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { NormalizedTask } from "../../schema";
import { evaluateLivePolicy } from "../live";

function baseScope(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-b36",
    userId: "user-b36",
    agentId: "agent-b36",
    spaceId: "space-b36",
    label: { visibility: "private" as const, policy: "agent_visible" as const, domain: null, sensitivity: null },
    purpose: "memory_search" as const,
    beliefStage: "silver_candidate_claim" as const,
    maxFreshnessSeconds: null,
    ...overrides,
  };
}

const minimalTask: NormalizedTask = {
  id: "task-b36",
  dataset: "memroos_public_synthetic",
  task_type: "single_hop",
  corpus: [],
  question: "q",
  expected_answer: "a",
  abstention_correct: false,
  license: "synthetic",
  citation: "batch36",
  provenance: {
    dataset: "memroos_public_synthetic",
    sourceCitation: "batch36",
    sourceLicense: "synthetic",
    sourceAvailability: "synthetic",
  },
};

describe("retrieval-bench live adapter batch36", () => {
  it("normalizeRequesterScope returns invalid_scope when normalize fails after input checks (106)", () => {
    const scope = {
      tenantId: "t-b36",
      userId: "u-b36",
      agentId: "a-b36",
      spaceId: "s-b36",
      purpose: "recall",
      beliefStage: "gold_claim",
      label: { visibility: "private", policy: "sealed", domain: 123 },
      maxFreshnessSeconds: null,
    };
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: {
        id: "c-b36",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: baseScope(),
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "invalid_scope" });
  });

  it("evaluateLivePolicy returns candidate_scope_malformed when candidate normalize fails (150)", () => {
    const scope = baseScope();
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: {
        id: "c-b36-malformed",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: {
          tenantId: "t-b36",
          userId: "u-b36",
          agentId: "a-b36",
          spaceId: "s-b36",
          purpose: "recall",
          beliefStage: "gold_claim",
          label: { visibility: "private", policy: "not-a-valid-policy" },
        },
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "candidate_scope_malformed" });
  });
});
