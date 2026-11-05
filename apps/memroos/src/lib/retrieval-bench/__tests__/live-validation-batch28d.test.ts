// @vitest-environment node
import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy, LIVE_ADAPTER_ID } from "../adapters/live";
import {
  hashFixtures,
  hashTaskIdentity,
  isDatasetId,
  isTaskType,
  partitionValidTasks,
  validateFixtures,
} from "../validation";
import type { NormalizedTask } from "../schema";

function minimalTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    id: `task-b28d-${randomUUID().slice(0, 8)}`,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "c1", text: "batch28d corpus fact" }],
    question: "What is batch28d?",
    expected_answer: "batch28d corpus fact",
    evidence_spans: ["c1"],
    citation: "batch28d",
    provenance: {
      dataset_version: "1",
      license: "internal",
      sourceCitation: "batch28d",
    },
    ...overrides,
  };
}

const scope = {
  tenantId: "tenant-b28d",
  userId: "user-b28d",
  agentId: "agent-b28d",
  spaceId: "space-b28d",
  purpose: "recall",
  beliefStage: "silver_candidate_claim",
  label: { visibility: "internal", policy: "agent_visible", domain: "engineering", sensitivity: "internal" },
  maxFreshnessSeconds: null,
};

describe("retrieval-bench live + validation batch28d", () => {
  it("evaluateLivePolicy denies abstention tasks", () => {
    const task = minimalTask({ abstention_correct: true });
    const decision = evaluateLivePolicy({
      task,
      scope,
      candidate: {
        id: "c1",
        timestamp_iso: "2026-07-17T10:00:00.000Z",
        scope,
      },
    });
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toBe("abstention_task_disallows_injection");
  });

  it("evaluateLivePolicy marks stale candidates when maxFreshnessSeconds exceeded", () => {
    const task = minimalTask();
    const decision = evaluateLivePolicy({
      task,
      scope: { ...scope, maxFreshnessSeconds: 60 },
      candidate: {
        id: "c1",
        timestamp_iso: "2020-01-01T00:00:00.000Z",
        scope,
      },
    });
    expect(decision.kind).toBe("stale");
    expect(decision.reason).toBe("candidate_too_old");
  });

  it("validateFixtures rejects non-array fixture input", () => {
    const result = validateFixtures({ not: "array" });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.reason).toBe("fixtures_not_array");
  });

  it("partitionValidTasks fails closed when any fixture task is invalid", () => {
    const valid = minimalTask();
    const partitioned = partitionValidTasks([valid, { id: "broken" }]);
    expect(partitioned.ok).toBe(false);
    expect(partitioned.valid).toHaveLength(0);
    expect(partitioned.invalid).toBeGreaterThanOrEqual(1);
  });

  it("hash helpers and type guards are stable", () => {
    const task = minimalTask();
    expect(isTaskType("single_hop")).toBe(true);
    expect(isDatasetId("memroos_public_synthetic")).toBe(true);
    expect(hashTaskIdentity(task)).toMatch(/^sha256:/);
    expect(hashFixtures([task])).toMatch(/^sha256:/);
    expect(LIVE_ADAPTER_ID).toBe("live");
  });
});
