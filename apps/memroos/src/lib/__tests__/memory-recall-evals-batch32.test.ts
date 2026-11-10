// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scoreMemoryRecallCase, summarizeMemoryEvalRun } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch32 — percentile95 and scoring branches", () => {
  it("summarizeMemoryEvalRun uses percentile95 over latencyMs (anonymous ~201, 270)", () => {
    const summary = summarizeMemoryEvalRun([
      { passed: true, metrics: { latencyMs: 10 } },
      { passed: true, metrics: { latencyMs: 20 } },
      { passed: false, metrics: { latencyMs: 200 } },
      { passed: true, metrics: { latencyMs: 30 } },
    ]);
    expect(summary.p95LatencyMs).toBe(200);
    expect(summary.totalCases).toBe(4);
  });

  it("summarizeMemoryEvalRun returns zero p95 when no cases", () => {
    expect(summarizeMemoryEvalRun([]).p95LatencyMs).toBe(0);
  });

  it("scoreMemoryRecallCase handles empty top-k latency (236)", () => {
    const scored = scoreMemoryRecallCase(
      {
        id: "batch32-empty-topk",
        layer: "gold",
        scenario: "empty retrieval",
        agentId: "memory-eval",
        taskPrompt: "Recall",
        expectedFacts: ["needle-b32"],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
      },
      [],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-11-09T00:00:00.000Z" }],
      3,
    );
    expect(scored.metrics.latencyMs).toBe(0);
    expect(scored.passed).toBe(false);
  });
});
