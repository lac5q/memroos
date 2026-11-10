// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy } from "../adapters/live";
import type { NormalizedTask } from "../schema";

function minimalTask(): NormalizedTask {
  return {
    id: `task-b33-${randomUUID().slice(0, 8)}`,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "c1", text: "batch33 corpus" }],
    question: "batch33?",
    expected_answer: "batch33 corpus",
    evidence_spans: ["c1"],
    citation: "batch33",
    provenance: {
      dataset_version: "1",
      license: "internal",
      sourceCitation: "batch33",
    },
  };
}

const baseScope = {
  tenantId: "tenant-b33",
  userId: "user-b33",
  agentId: "agent-b33",
  spaceId: "space-b33",
  purpose: "recall" as const,
  beliefStage: "silver_candidate_claim" as const,
  label: {
    visibility: "internal" as const,
    policy: "agent_visible" as const,
    domain: "engineering",
    sensitivity: "internal",
  },
  maxFreshnessSeconds: null as number | null,
};

describe("retrieval-bench live adapter batch33", () => {
  it("normalizeRequesterScope denies incomplete scope (106)", () => {
    const decision = evaluateLivePolicy({
      task: minimalTask(),
      scope: undefined,
      candidate: { id: "c1", timestamp_iso: "2026-01-01T00:00:00.000Z", scope: baseScope },
    });
    expect(decision).toEqual({ kind: "deny", reason: "incomplete_scope" });
  });

  it("denies candidate_scope_malformed when normalizeScopeIdentity fails (150)", () => {
    const decision = evaluateLivePolicy({
      task: minimalTask(),
      scope: baseScope,
      candidate: {
        id: "c1",
        timestamp_iso: "2026-01-01T00:00:00.000Z",
        scope: {
          ...baseScope,
          beliefStage: "not-a-real-stage" as never,
        },
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "candidate_scope_malformed" });
  });
});
