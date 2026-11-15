// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTask } from "../../schema";
import * as scopeIdentity from "@/lib/msiq/scope-identity";
import { evaluateLivePolicy } from "../live";

const baseScope = {
  tenantId: "tenant-b38b",
  userId: "user-b38b",
  agentId: "agent-b38b",
  spaceId: "space-b38b",
  label: { visibility: "private" as const, policy: "agent_visible" as const, domain: null, sensitivity: null },
  purpose: "memory_search" as const,
  beliefStage: "silver_candidate_claim" as const,
  maxFreshnessSeconds: null,
};

const minimalTask: NormalizedTask = {
  id: "task-b38b",
  dataset: "memroos_public_synthetic",
  task_type: "single_hop",
  corpus: [],
  question: "q",
  expected_answer: "a",
  abstention_correct: false,
  license: "synthetic",
  citation: "batch38b",
  provenance: {
    dataset: "memroos_public_synthetic",
    sourceCitation: "batch38b",
    sourceLicense: "synthetic",
    sourceAvailability: "synthetic",
  },
};

describe("retrieval-bench live adapter batch38b", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizeRequesterScope returns invalid_scope when normalize returns null after input checks (106)", () => {
    vi.spyOn(scopeIdentity, "normalizeScopeIdentity").mockReturnValue(null);
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope: baseScope,
      candidate: {
        id: "c-b38b",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: baseScope,
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "invalid_scope" });
  });

  it("evaluateLivePolicy returns candidate_scope_malformed when candidate normalize fails (150)", () => {
    const decision = evaluateLivePolicy({
      task: minimalTask,
      scope: baseScope,
      candidate: {
        id: "c-b38b-malformed",
        timestamp_iso: "2026-11-12T00:00:00.000Z",
        scope: {
          tenantId: "t-b38b",
          userId: "u-b38b",
          agentId: "a-b38b",
          spaceId: "s-b38b",
          purpose: "memory_search",
          beliefStage: "silver_candidate_claim",
          label: { visibility: "private", policy: "not-a-live-policy" },
        },
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "candidate_scope_malformed" });
  });
});