// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assembleRecollectionContextPack } from "../proactive-recollection";

describe("proactive-recollection batch22b — pack budget trimming", () => {
  it("truncates candidate text to remaining char budget and ignores empty trims", () => {
    const pack = assembleRecollectionContextPack({
      decision: {
        action: "search",
        timing: "pre_turn",
        required: true,
        score: 0.9,
        threshold: 0.1,
        triggers: ["task_resume"],
        skipReason: null,
        authorization: "allowed",
        allowedProjectIds: ["p1"],
        deniedProjectIds: [],
        reason: "resume",
      },
      plans: [{ id: "plan-1", tier: "episodic", terms: ["resume"], projectId: "p1" }],
      rankedCandidates: [
        {
          id: "c1",
          tier: "episodic",
          projectId: "p1",
          score: 0.95,
          text: "x".repeat(20),
          citation: "cite-1",
          components: { recency: 1, relevance: 1, trust: 1 },
        },
        {
          id: "c2",
          tier: "vector",
          projectId: "p1",
          score: 0.9,
          text: "y".repeat(20),
          citation: "cite-2",
          components: { recency: 1, relevance: 1, trust: 1 },
        },
      ],
      maxItems: 5,
      maxChars: 12,
      scoreThreshold: 0.1,
    });
    expect(pack.entries.length).toBe(1);
    expect(pack.entries[0]?.text.length).toBeLessThanOrEqual(11);
    expect(pack.receipt.ignored.some((row) => row.reason === "pack_budget_exhausted")).toBe(true);
  });
});
