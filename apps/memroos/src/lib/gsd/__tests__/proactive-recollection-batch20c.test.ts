// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  assembleRecollectionContextPack,
  evaluateRecollectionTrigger,
  planRecollectionQueries,
  rankRecollectionCandidates,
} from "@/lib/gsd/proactive-recollection";

describe("proactive-recollection batch20c", () => {
  it("evaluateRecollectionTrigger skips when disabled", () => {
    const receipt = evaluateRecollectionTrigger({
      timing: "before_plan",
      taskText: "remember the launch checklist",
      enabled: false,
      projectId: "proj-a",
    });
    expect(receipt.action).toBe("skip");
    expect(receipt.skipReason).toBe("disabled");
  });

  it("evaluateRecollectionTrigger searches when handoff blockers clear threshold", () => {
    const receipt = evaluateRecollectionTrigger({
      timing: "before_dispatch",
      taskText: "Continue the deployment handoff for Q3 roadmap",
      projectId: "proj-a",
      handoff: { unresolved: true, blockerCount: 2 },
      minTriggerScore: 0.2,
    });
    expect(receipt.action).toBe("search");
    expect(receipt.triggers).toContain("unresolved_handoff");
  });

  it("planRecollectionQueries returns empty list when decision is skip", () => {
    const decision = evaluateRecollectionTrigger({
      timing: "before_tool_use",
      taskText: "",
      projectId: "proj-a",
    });
    expect(planRecollectionQueries({ decision, taskText: "x", projectId: "proj-a" })).toEqual([]);
  });

  it("rankRecollectionCandidates and assembleRecollectionContextPack bound output", () => {
    const decision = evaluateRecollectionTrigger({
      timing: "before_final",
      taskText: "Summarize meeting notes with citations",
      projectId: "proj-a",
      sourceRefs: [{ id: "src-1", kind: "file", projectId: "proj-a" }],
      alreadyHasCitations: false,
      minTriggerScore: 0.2,
    });
    expect(decision.action).toBe("search");
    const ranked = rankRecollectionCandidates([
      {
        id: "c1",
        tier: "vector",
        projectId: "proj-a",
        text: "Roadmap item alpha",
        relevance: 0.9,
        authorization: "allowed",
      },
    ]);
    expect(ranked.length).toBeGreaterThan(0);
    const plans = planRecollectionQueries({
      decision,
      taskText: "Summarize meeting notes with citations",
      projectId: "proj-a",
    });
    const pack = assembleRecollectionContextPack({
      decision,
      plans,
      rankedCandidates: ranked,
      maxItems: 2,
      maxChars: 500,
      scoreThreshold: 0,
    });
    expect(pack.entries.length).toBeLessThanOrEqual(2);
    expect(pack.receipt.injectedCount).toBeGreaterThan(0);
  });
});
