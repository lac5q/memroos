// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy } from "../adapters/live";
import type { NormalizedTask } from "../schema";

function minimalTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    id: `task-b30b-${randomUUID().slice(0, 8)}`,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "c1", text: "batch30b corpus fact" }],
    question: "batch30b?",
    expected_answer: "batch30b corpus fact",
    evidence_spans: ["c1"],
    citation: "batch30b",
    provenance: {
      dataset_version: "1",
      license: "internal",
      sourceCitation: "batch30b",
    },
    ...overrides,
  };
}

const baseScope = {
  tenantId: "tenant-b30b",
  userId: "user-b30b",
  agentId: "agent-b30b",
  spaceId: "space-b30b",
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

describe("retrieval-bench live adapter batch30b — scope guards", () => {
  it("invalid purpose (line 78) and undefined scope requester (line 106)", () => {
    const task = minimalTask();
    const badPurpose = evaluateLivePolicy({
      task,
      scope: { ...baseScope, purpose: "not-a-live-purpose" as never },
      candidate: { id: "c1", timestamp_iso: "2026-01-01T00:00:00.000Z", scope: baseScope },
    });
    expect(badPurpose.kind).toBe("deny");
    expect(badPurpose.reason).toBe("invalid_purpose");

    const missingScope = evaluateLivePolicy({
      task,
      scope: undefined,
      candidate: { id: "c1", timestamp_iso: "2026-01-01T00:00:00.000Z", scope: baseScope },
    });
    expect(missingScope.kind).toBe("deny");
    expect(missingScope.reason).toBe("incomplete_scope");
  });

  it("candidate scope issues and malformed label normalization (lines 148–150)", () => {
    const task = minimalTask();
    const badCandPurpose = evaluateLivePolicy({
      task,
      scope: baseScope,
      candidate: {
        id: "c1",
        timestamp_iso: "2026-01-01T00:00:00.000Z",
        scope: { ...baseScope, purpose: "bad" as never },
      },
    });
    expect(badCandPurpose.kind).toBe("deny");
    expect(badCandPurpose.reason).toBe("candidate_invalid_purpose");

    const malformed = evaluateLivePolicy({
      task,
      scope: baseScope,
      candidate: {
        id: "c1",
        timestamp_iso: "2026-01-01T00:00:00.000Z",
        scope: {
          ...baseScope,
          label: { ...baseScope.label, domain: 123 as unknown as string },
        },
      },
    });
    expect(malformed.kind).toBe("deny");
    expect(malformed.reason).toBe("candidate_scope_malformed");
  });
});
