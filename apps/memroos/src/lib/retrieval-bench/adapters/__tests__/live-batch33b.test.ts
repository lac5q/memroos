// @vitest-environment node
import { describe, expect, it } from "vitest";

import { evaluateLivePolicy } from "../live";

describe("retrieval-bench live adapter batch33b", () => {
  it("evaluateLivePolicy denies invalid requester scope normalization (106)", () => {
    const decision = evaluateLivePolicy({
      task: {
        id: "task-b33b-req",
        abstention_correct: false,
        corpus: [],
      } as never,
      scope: {
        tenantId: "",
        userId: "u",
        agentId: "a",
        spaceId: "s",
        label: { visibility: "private", policy: "agent_visible" },
        purpose: "memory_search",
        beliefStage: "silver_candidate_claim",
        maxFreshnessSeconds: null,
      },
      candidate: { id: "c1", timestamp_iso: "2026-11-10T00:00:00.000Z", scope: {} },
    });
    expect(decision.kind).toBe("deny");
    if (decision.kind === "deny") expect(decision.reason).toBe("incomplete_scope");
  });
});
