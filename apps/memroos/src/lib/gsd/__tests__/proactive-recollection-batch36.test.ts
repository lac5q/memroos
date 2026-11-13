// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { evaluateRecollectionTrigger, rankRecollectionCandidates } from "../proactive-recollection";

describe("proactive-recollection batch36", () => {
  it("returns disabled skipReason when enabled is false (299-312)", () => {
    const receipt = evaluateRecollectionTrigger({
      taskText: "memory recall for batch36",
      timing: "before_plan",
      enabled: false,
    });
    expect(receipt.skipReason).toBe("disabled");
    expect(receipt.action).toBe("skip");
  });

  it("policy_denied when candidates are outside allowlist (280-281)", () => {
    const receipt = evaluateRecollectionTrigger({
      taskText: "cross project memory lookup batch36",
      timing: "before_plan",
      candidateProjectIds: ["proj-x-b36"],
      crossProjectAllowlist: [],
    });
    expect(receipt.authorization).toBe("denied");
    expect(receipt.skipReason).toBe("policy_denied");
  });

  it("coerceDateMs returns null for invalid date strings (250-251)", () => {
    const ranked = rankRecollectionCandidates(
      [
        {
          id: `cand-b36-${randomUUID().slice(0, 6)}`,
          tier: "episodic",
          content: "invalid observedAt",
          observedAt: "not-a-real-date-b36",
          authorization: "allowed",
          policyRisk: 0.1,
          relevance: 0.5,
        },
      ],
      { now: "2026-06-01T00:00:00.000Z", recencyHalfLifeDays: 7 },
    );
    expect(ranked.length).toBe(1);
    expect(ranked[0]?.components.recency).toBeGreaterThanOrEqual(0);
  });

  it("explicit_memory_request trigger when task mentions memory (333-335)", () => {
    const receipt = evaluateRecollectionTrigger({
      taskText: "Please memory recall the deployment checklist for batch36",
      timing: "before_plan",
      projectId: "proj-b36",
    });
    expect(receipt.triggers).toContain("explicit_memory_request");
  });
});
