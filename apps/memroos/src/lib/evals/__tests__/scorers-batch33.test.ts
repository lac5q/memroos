// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createBuiltInScorers } from "../scorers";
import type { EvalScoringContext } from "../types";

const context = {
  config: { scorers: { l1Capability: ["memory_recall_l2"], l2Quality: [], l3Outcome: [] } },
  judge: { rubricScores: { faithful: 0.5, useful: 0.5, policy: 0.5 } },
} as EvalScoringContext;

describe("evals scorers batch33", () => {
  it("memory_recall_l2 average handles empty precision/mrr via memoryRecallScore (17, 32)", () => {
    const scorers = createBuiltInScorers();
    const scorer = scorers.find((s) => s.id === "memory_recall_l2");
    expect(scorer).toBeDefined();
    const scored = scorer!.score(
      {
        traceId: "t-b33",
        agentId: "a-b33",
        input: "q",
        output: "answer",
        memory: { expectedFacts: [], retrievedFacts: [] },
      },
      context,
    );
    expect(scored.score).toBe(0.5);
  });
});
