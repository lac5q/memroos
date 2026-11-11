// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  evaluateRecollectionTrigger,
  planRecollectionQueries,
  rankRecollectionCandidates,
} from "../proactive-recollection";

describe("proactive-recollection batch34b", () => {
  it("coerces invalid dates and tokenizes entity-rich tasks (244–261, 361–388)", () => {
    const receipt = evaluateRecollectionTrigger({
      taskText: "Review MemRoOS AlphaBeta deployment blockers with citations",
      timing: "before_final",
      projectId: "proj-a",
      candidateProjectIds: ["proj-b"],
      crossProjectAllowlist: ["proj-b"],
      operatorReaskCount: 2,
      rediscoveredFactCount: 1,
      recentHighSalienceFacts: 2,
      alreadyHasCitations: false,
      sourceRefs: [{ id: "src-1", changed: true, stale: true, healthy: false }],
      handoff: { unresolved: true, blockerCount: 1 },
      enabled: true,
    });
    expect(receipt.authorization).toBe("allowlisted_cross_project");
    expect(receipt.triggers).toContain("operator_reask");
    expect(receipt.triggers).toContain("final_answer_citation_gap");

    const denied = evaluateRecollectionTrigger({
      taskText: "memory recall cross project lookup",
      timing: "before_plan",
      candidateProjectIds: ["proj-x"],
      crossProjectAllowlist: [],
    });
    expect(denied.skipReason).toBe("policy_denied");

    const blank = evaluateRecollectionTrigger({
      taskText: "   ",
      timing: "before_plan",
      projectId: "proj-a",
    });
    expect(blank.skipReason).toBe("blank_task");
  });

  it("plans qmd tier queries and ranks stale candidates (420–437, 460–462)", () => {
    const decision = evaluateRecollectionTrigger({
      taskText: "memory recall handoff blockers changed-source",
      timing: "before_plan",
      projectId: "proj-a",
      sourceRefs: [{ id: "qmd-1", healthy: false }],
      handoff: { unresolved: true, blockerCount: 2 },
    });
    expect(decision.action).toBe("search");

    const plans = planRecollectionQueries({
      decision,
      taskText: decision.reason,
      projectId: "proj-a",
      sourceRefs: [{ id: "qmd-1", healthy: false }],
      tiers: ["episodic", "qmd_source"],
    });
    expect(plans.every((plan) => !plan.tiers.includes("qmd_source"))).toBe(true);

    const ranked = rankRecollectionCandidates(
      [
        {
          id: `cand-${randomUUID().slice(0, 6)}`,
          tier: "episodic",
          content: "stale fact",
          observedAt: "2020-01-01T00:00:00.000Z",
          sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
          sourceStale: true,
          authorization: "denied",
          policyRisk: 0.8,
          relevance: 0.9,
        },
      ],
      { now: "2026-06-01T00:00:00.000Z", recencyHalfLifeDays: 7 },
    );
    expect(ranked[0]?.components.freshness).toBe(0.2);
    expect(ranked[0]?.components.policySafety).toBeLessThan(0.5);
  });
});
