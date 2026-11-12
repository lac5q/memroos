// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { NormalizedTask } from "../../schema";
import { evaluateLivePolicy } from "../live";

const baseLabel = { visibility: "private" as const, policy: "sealed" as const };

function baseScope(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "t1",
    userId: "u1",
    agentId: "a1",
    spaceId: "s1",
    purpose: "recall",
    beliefStage: "gold_claim",
    label: baseLabel,
    maxFreshnessSeconds: null,
    ...overrides,
  };
}

const minimalTask: NormalizedTask = {
  id: "task-b29",
  dataset: "memroos_public_synthetic",
  task_type: "single_hop",
  corpus: [],
  question: "q",
  expected_answer: "a",
  abstention_correct: false,
  license: "synthetic",
  citation: "batch29",
  provenance: {
    dataset: "memroos_public_synthetic",
    sourceCitation: "batch29",
    sourceLicense: "synthetic",
    sourceAvailability: "synthetic",
  },
};

describe("live adapter batch29 — evaluateLivePolicy denial branches", () => {
  it("denies invalid purpose (lines 78–79)", () => {
    const scope = baseScope({ purpose: "not-a-live-purpose" });
    const d = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: { id: "c1", scope },
    });
    expect(d).toEqual({ kind: "deny", reason: "invalid_purpose" });
  });

  it("denies bad beliefStage (lines 80–81)", () => {
    const scope = baseScope({ beliefStage: "not-a-stage" });
    const d = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: { id: "c1", scope },
    });
    expect(d).toEqual({ kind: "deny", reason: "invalid_scope" });
  });

  it("denies candidate label null (line 106 via candidate path)", () => {
    const scope = baseScope();
    const d = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: {
        id: "c1",
        scope: { ...scope, label: null },
      },
    });
    expect(d).toEqual({ kind: "deny", reason: "candidate_scope_missing" });
  });

  it("denies when normalizeRequesterScope returns null (line 106)", () => {
    const scope = {
      tenantId: "t1",
      userId: "u1",
      agentId: "a1",
      spaceId: "s1",
      purpose: "recall",
      beliefStage: "gold_claim",
      label: { visibility: "private", policy: "sealed", domain: 123 },
      maxFreshnessSeconds: null,
    };
    const d = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: { id: "c1", scope: baseScope() },
    });
    expect(d).toEqual({ kind: "deny", reason: "invalid_scope" });
  });

  it("denies when candidate.scope fails normalizeScopeIdentity (line 150)", () => {
    const scope = baseScope();
    const d = evaluateLivePolicy({
      task: minimalTask,
      scope,
      candidate: {
        id: "c1",
        scope: {
          tenantId: "t1",
          userId: "u1",
          agentId: "a1",
          spaceId: "s1",
          purpose: "recall",
          beliefStage: "gold_claim",
          label: { visibility: "private", policy: "not-a-valid-policy" },
        },
      },
    });
    expect(d).toEqual({ kind: "deny", reason: "candidate_scope_malformed" });
  });
});
