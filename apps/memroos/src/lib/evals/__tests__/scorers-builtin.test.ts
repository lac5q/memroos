// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createBuiltInScorers, scorerIdsForLayer } from "../scorers";
import type { EvalScoringContext } from "../types";

const context: EvalScoringContext = {
  config: {
    scorers: {
      l1Capability: ["tool_call_schema", "json_valid"],
      l2Quality: ["rubric_5pt_faithful"],
      l3Outcome: ["completion_rate", "cost_per_task"],
    },
  },
  judge: {
    rubricScores: { faithful: 0.9, useful: 0.8, policy: 1 },
  },
} as EvalScoringContext;

describe("built-in eval scorers", () => {
  it("scores neutral traces across L1/L2/L3 layers", () => {
    const scorers = createBuiltInScorers();
    const trace = {
      traceId: "t1",
      agentId: "a1",
      input: "task",
      output: '{"ok":true}',
      expectedFacts: ["ok"],
      toolCalls: [{ name: "read", valid: true, schemaValid: true }],
      memory: { expectedFacts: ["fact-a"], retrievedFacts: ["fact-a"], recallAtK: 1 },
      outcome: { completed: true, costUsd: 0.01, ttrMs: 30_000 },
    };

    for (const scorer of scorers.filter((s) => s.layer === "l1").slice(0, 4)) {
      const scored = scorer.score(trace, context);
      expect(scored.score).toBeGreaterThanOrEqual(0);
      expect(scored.score).toBeLessThanOrEqual(1);
    }

    const costScorer = scorers.find((s) => s.id === "cost_per_task")!;
    expect(costScorer.score({ ...trace, outcome: {} }, context).score).toBe(0.5);
  });

  it("selects configured scorer ids per layer", () => {
    expect(scorerIdsForLayer(context, "l1")).toEqual(["tool_call_schema", "json_valid"]);
    expect(scorerIdsForLayer(context, "l3")).toContain("completion_rate");
  });
});
