// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  hasRequiredRecallTiming,
  scoreMemoryRecallCase,
  summarizeMemoryEvalRun,
  type MemoryRecallTraceEvent,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch37 — timing, summary, avoid facts", () => {
  it("hasRequiredRecallTiming rejects late recall (204-210)", () => {
    const trace: MemoryRecallTraceEvent[] = [
      { action: "memory_recall", timing: "before_final", tier: "vector", timestamp: new Date().toISOString() },
    ];
    expect(hasRequiredRecallTiming(trace, "before_plan")).toBe(false);
    expect(hasRequiredRecallTiming(trace, "before_final")).toBe(true);
  });

  it("summarizeMemoryEvalRun percentile95 returns 0 for empty latencies (197-201)", () => {
    const summary = summarizeMemoryEvalRun([]);
    expect(summary.totalCases).toBe(0);
    expect(summary.p95LatencyMs).toBe(0);
    expect(summary.passRate).toBe(0);
  });

  it("summarizeMemoryEvalRun computes p95 over latency metrics (270)", () => {
    const summary = summarizeMemoryEvalRun([
      { passed: true, metrics: { latencyMs: 10 } },
      { passed: false, metrics: { latencyMs: 50 } },
      { passed: true, metrics: { latencyMs: 100 } },
      { passed: true, metrics: { latencyMs: 200 } },
    ]);
    expect(summary.p95LatencyMs).toBeGreaterThanOrEqual(100);
    expect(summary.failedCases).toBe(1);
  });

  it("scoreMemoryRecallCase flags avoided facts in top-k (249-250)", () => {
    const avoidToken = `avoid-b37-${randomUUID().slice(0, 8)}`;
    const scored = scoreMemoryRecallCase(
      {
        id: "avoid-b37",
        layer: "gold",
        scenario: "avoid fact",
        agentId: "memory-eval",
        taskPrompt: "Recall without leak",
        expectedFacts: ["expected-b37"],
        avoidFacts: [avoidToken],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
        fixtures: [],
      },
      [
        {
          id: "hit-b37",
          tier: "vector",
          content: `expected-b37 plus ${avoidToken}`,
          score: 0.9,
          latencyMs: 12,
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", tier: "vector", timestamp: new Date().toISOString() }],
    );
    expect(scored.passed).toBe(false);
    expect(scored.failures).toContain("avoided fact found in top k");
  });
});