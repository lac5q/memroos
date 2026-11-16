// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { NormalizedTask } from "../../schema";
import { evaluateLivePolicy } from "../live";

const MATCHING_SCOPE = {
  tenantId: "tenant-b39",
  userId: "user-b39",
  agentId: "agent-b39",
  spaceId: "space-b39",
  label: {
    visibility: "internal" as const,
    policy: "agent_visible" as const,
    domain: "batch39",
    sensitivity: null,
  },
  purpose: "memory_search" as const,
  beliefStage: "silver_candidate_claim" as const,
};

function requesterScope(overrides: Record<string, unknown> = {}) {
  return {
    ...MATCHING_SCOPE,
    maxFreshnessSeconds: null,
    ...overrides,
  };
}

const minimalTask: NormalizedTask = {
  id: "task-b39",
  dataset: "memroos_public_synthetic",
  task_type: "single_hop",
  corpus: [],
  question: "q",
  expected_answer: "a",
  abstention_correct: false,
  license: "synthetic",
  citation: "batch39",
  provenance: {
    dataset: "memroos_public_synthetic",
    sourceCitation: "batch39",
    sourceLicense: "synthetic",
    sourceAvailability: "synthetic",
  },
};

describe("retrieval-bench live adapter batch39 — evaluateLivePolicy branches", () => {
  it("denies scope mismatches via scopeMismatchReason", () => {
    const cases = [
      ["tenant_mismatch", { tenantId: "foreign-tenant" }],
      ["user_mismatch", { userId: "foreign-user" }],
      ["agent_mismatch", { agentId: "foreign-agent" }],
      ["space_mismatch", { spaceId: "foreign-space" }],
      [
        "label_mismatch",
        { label: { ...MATCHING_SCOPE.label, policy: "sealed" as const } },
      ],
      ["purpose_mismatch", { purpose: "recall" as const }],
      ["belief_stage_mismatch", { beliefStage: "gold_claim" as const }],
    ] as const;
    for (const [reason, override] of cases) {
      const decision = evaluateLivePolicy({
        task: minimalTask,
        scope: requesterScope(),
        candidate: {
          id: `c-b39-${reason}`,
          timestamp_iso: "2026-11-12T00:00:00.000Z",
          scope: { ...MATCHING_SCOPE, ...override },
        },
      });
      expect(decision).toEqual({ kind: "deny", reason });
    }
  });

  it("denies abstention_task_disallows_injection when abstention_correct is true", () => {
    const decision = evaluateLivePolicy({
      task: { ...minimalTask, abstention_correct: true },
      scope: requesterScope(),
      candidate: {
        id: "c-abstain",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: MATCHING_SCOPE,
      },
    });
    expect(decision).toEqual({
      kind: "deny",
      reason: "abstention_task_disallows_injection",
    });
  });

  it("marks timestamp_unparseable stale when maxFreshnessSeconds is set", () => {
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope: requesterScope({ maxFreshnessSeconds: 60 }),
      candidate: {
        id: "c-bad-ts",
        timestamp_iso: "not-a-real-timestamp",
        scope: MATCHING_SCOPE,
      },
    });
    expect(decision).toEqual({ kind: "stale", reason: "timestamp_unparseable" });
  });

  it("marks candidate_too_old when beyond maxFreshnessSeconds", () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope: requesterScope({ maxFreshnessSeconds: 60 }),
      candidate: {
        id: "c-old",
        timestamp_iso: old,
        scope: MATCHING_SCOPE,
      },
    });
    expect(decision).toEqual({ kind: "stale", reason: "candidate_too_old" });
  });

  it("allows policy_allows on happy path", () => {
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope: requesterScope(),
      candidate: {
        id: "c-ok",
        timestamp_iso: new Date().toISOString(),
        scope: MATCHING_SCOPE,
      },
    });
    expect(decision).toEqual({ kind: "allow", reason: "policy_allows" });
  });

  it("denies incomplete_scope and candidate_scope_missing for null scope", () => {
    expect(
      evaluateLivePolicy({
        task: minimalTask,
        scope: null as never,
        candidate: {
          id: "c1",
          timestamp_iso: "2026-11-12T00:00:00.000Z",
          scope: MATCHING_SCOPE,
        },
      }),
    ).toEqual({ kind: "deny", reason: "incomplete_scope" });

    expect(
      evaluateLivePolicy({
        task: minimalTask,
        scope: requesterScope(),
        candidate: {
          id: "c-missing",
          timestamp_iso: "2026-11-12T00:00:00.000Z",
          scope: null,
        },
      }),
    ).toEqual({ kind: "deny", reason: "candidate_scope_missing" });
  });
});