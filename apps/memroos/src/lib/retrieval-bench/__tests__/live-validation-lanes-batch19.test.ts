// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { evaluateLivePolicy, liveAdapter } from "../adapters/live";
import { validateTask } from "../validation";
import { DATASET_TO_LANE } from "../schema";
import { LANE_METADATA, resolveLaneForDataset, verifyLaneAssignments } from "../lanes";

const LIVE_SCOPE = {
  tenantId: "benchmark-tenant",
  userId: "benchmark-user",
  agentId: "benchmark-agent",
  spaceId: "benchmark-space",
  label: {
    visibility: "internal" as const,
    policy: "agent_visible" as const,
    domain: "benchmark",
    sensitivity: null,
  },
  purpose: "memory_search" as const,
  beliefStage: "silver_candidate_claim" as const,
  maxFreshnessSeconds: 3600,
};

describe("retrieval-bench live/validation/lanes batch19", () => {
  it("evaluateLivePolicy rejects malformed label.domain and label.sensitivity types", () => {
    const badDomain = evaluateLivePolicy({
      task: { id: "t1", abstention_correct: false } as never,
      scope: {
        ...LIVE_SCOPE,
        label: { ...LIVE_SCOPE.label, domain: 42 as unknown as string },
      },
      candidate: {
        id: "c1",
        timestamp_iso: new Date().toISOString(),
        scope: LIVE_SCOPE,
      },
    });
    expect(badDomain.kind).toBe("deny");
    expect(badDomain.reason).toBe("invalid_scope");

    const badSensitivity = evaluateLivePolicy({
      task: { id: "t2", abstention_correct: false } as never,
      scope: {
        ...LIVE_SCOPE,
        label: { ...LIVE_SCOPE.label, sensitivity: false as unknown as string },
      },
      candidate: {
        id: "c2",
        timestamp_iso: new Date().toISOString(),
        scope: LIVE_SCOPE,
      },
    });
    expect(badSensitivity.kind).toBe("deny");
  });

  it("evaluateLivePolicy marks unparseable timestamps as stale", () => {
    const decision = evaluateLivePolicy({
      task: { id: "t-stale", abstention_correct: false } as never,
      scope: { ...LIVE_SCOPE, maxFreshnessSeconds: 60 },
      candidate: {
        id: "c-stale",
        timestamp_iso: "not-a-real-timestamp",
        scope: LIVE_SCOPE,
      },
    });
    expect(decision.kind).toBe("stale");
    expect(decision.reason).toBe("timestamp_unparseable");
  });

  it("liveAdapter increments stale ignored receipts for old corpus entries", async () => {
    const result = await liveAdapter.run({
      task: {
        id: "live-stale-b19",
        question: "test",
        abstention_correct: false,
        corpus: [
          {
            id: "mem-stale-b19",
            text: "stale corpus entry",
            timestamp_iso: "2010-01-01T00:00:00.000Z",
            scope: LIVE_SCOPE,
          },
        ],
      } as never,
      k: 3,
      configHash: "sha256:cfg",
      fixtureHash: "sha256:fix",
      scope: LIVE_SCOPE,
    });
    expect(result.retrieved).toEqual([]);
    expect(
      result.ignored.some(
        (item) => item.id === "mem-stale-b19" && item.reasonCode === "candidate_too_old",
      ),
    ).toBe(true);
  });

  it("validateTask rejects malformed sessions and temporal_metadata object", () => {
    const base = {
      id: "task-sessions-b19",
      dataset: "memroos_public_synthetic",
      task_type: "single_hop",
      corpus: [{ id: "mem-1", text: "Fact text." }],
      question: "Q?",
      expected_answer: "A",
      evidence_spans: ["mem-1"],
      license: "MIT",
      citation: "MemroOS synthetic",
      provenance: {
        dataset: "memroos_public_synthetic",
        sourceCitation: "MemroOS synthetic",
        sourceLicense: "MIT",
        sourceAvailability: "synthetic",
      },
    };
    const sessionNotObject = validateTask(
      { ...base, sessions: ["not-an-object"] },
      { seenIds: new Set() },
    );
    expect(sessionNotObject.ok).toBe(false);

    const turnsNotArray = validateTask(
      {
        ...base,
        sessions: [{ session_id: "s1", turns: "bad" }],
      },
      { seenIds: new Set() },
    );
    expect(turnsNotArray.ok).toBe(false);

    const temporalNotObject = validateTask(
      { ...base, temporal_metadata: "bad" },
      { seenIds: new Set() },
    );
    expect(temporalNotObject.ok).toBe(false);
  });

  it("resolveLaneForDataset flags datasets assigned to multiple lanes", () => {
    const backup = [...LANE_METADATA.architecture_evidence.datasets];
    LANE_METADATA.architecture_evidence.datasets = [...backup, "memroos_public_synthetic"];
    try {
      const multi = resolveLaneForDataset("memroos_public_synthetic");
      expect(multi.ok).toBe(false);
      expect(multi.reason).toContain("dataset_belongs_to_multiple_lanes");
    } finally {
      LANE_METADATA.architecture_evidence.datasets = backup;
    }
  });

  it("verifyLaneAssignments reports unknown lane keys and missing datasets", () => {
    const snapshot = { ...DATASET_TO_LANE };
    try {
      (DATASET_TO_LANE as Record<string, string>)["__unknown_lane_dataset_b19"] =
        "not_a_real_lane" as never;
      (DATASET_TO_LANE as Record<string, string>)["memroos_public_synthetic"] =
        "operational_workflow" as never;
      const drift = verifyLaneAssignments();
      expect(drift.ok).toBe(false);
      expect(drift.mismatches.some((m) => m.includes("_lane_unknown"))).toBe(true);
      expect(drift.mismatches.some((m) => m.includes("missing_from_lane"))).toBe(true);
    } finally {
      for (const key of Object.keys(DATASET_TO_LANE)) {
        delete (DATASET_TO_LANE as Record<string, string>)[key];
      }
      Object.assign(DATASET_TO_LANE, snapshot);
    }
  });
});
