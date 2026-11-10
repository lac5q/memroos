// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy } from "../adapters/live";
import type { NormalizedTask } from "../schema";

function minimalTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    id: `task-b31-${randomUUID().slice(0, 8)}`,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "c1", text: "batch31 corpus" }],
    question: "batch31?",
    expected_answer: "batch31 corpus",
    evidence_spans: ["c1"],
    citation: "batch31",
    provenance: {
      dataset_version: "1",
      license: "internal",
      sourceCitation: "batch31",
    },
    ...overrides,
  };
}

const baseScope = {
  tenantId: "tenant-b31",
  userId: "user-b31",
  agentId: "agent-b31",
  spaceId: "space-b31",
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

describe("retrieval-bench live adapter batch31 — scopeInputIssue branches", () => {
  it("denies requester scope when purpose is missing (L78)", () => {
    const task = minimalTask();
    const { purpose: _drop, ...scopeMissingPurpose } = baseScope;
    const decision = evaluateLivePolicy({
      task,
      scope: scopeMissingPurpose as typeof baseScope,
      candidate: { id: "c1", timestamp_iso: "2026-01-01T00:00:00.000Z", scope: baseScope },
    });
    expect(decision).toEqual({ kind: "deny", reason: "incomplete_scope" });
  });

  it("denies when requester scope is undefined (L106)", () => {
    const decision = evaluateLivePolicy({
      task: minimalTask(),
      scope: undefined,
      candidate: { id: "c1", timestamp_iso: "2026-01-01T00:00:00.000Z", scope: baseScope },
    });
    expect(decision).toEqual({ kind: "deny", reason: "incomplete_scope" });
  });

  it("denies when candidate scope fails normalizeScopeIdentity (L150)", () => {
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
