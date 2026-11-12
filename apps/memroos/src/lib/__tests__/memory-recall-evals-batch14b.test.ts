// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ensureMemoryEvalTables,
  getLatestMemoryEvalRun,
  hasRequiredRecallTiming,
  summarizeMemoryEvalRun,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch14b", () => {
  it("hasRequiredRecallTiming respects phase ordering", () => {
    const trace = [
      { action: "memory_recall" as const, timing: "before_final" as const, timestamp: "t1" },
    ];
    expect(hasRequiredRecallTiming(trace, "before_final")).toBe(true);
    expect(hasRequiredRecallTiming(trace, "before_plan")).toBe(false);
    expect(
      hasRequiredRecallTiming([{ action: "plan", timing: "before_plan", timestamp: "t0" }], "before_plan"),
    ).toBe(false);
  });

  it("summarizeMemoryEvalRun computes p95 latency and tier failures", () => {
    const summary = summarizeMemoryEvalRun([
      { passed: true, metrics: { latencyMs: 10 }, tiers: [{ tier: "vector", ok: true, count: 1 }] },
      { passed: false, metrics: { latencyMs: 100 }, tiers: [{ tier: "graph", ok: false, count: 0 }] },
      { passed: true, metrics: { latencyMs: 200 }, tiers: [{ tier: "vector", ok: true, count: 2 }] },
    ]);
    expect(summary.totalCases).toBe(3);
    expect(summary.passedCases).toBe(2);
    expect(summary.tierFailures).toContain("graph");
    expect(summary.p95LatencyMs).toBeGreaterThanOrEqual(100);
  });

  it("ensureMemoryEvalTables + getLatestMemoryEvalRun round-trip stored run", () => {
    const db = new Database(":memory:");
    ensureMemoryEvalTables(db);
    const runId = `run-${crypto.randomUUID()}`;
    const summary = {
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      passRate: 1,
      p95LatencyMs: 12,
      tierFailures: [],
    };
    db.prepare(
      `INSERT INTO memory_eval_runs (id, mode, status, summary, started_at, completed_at)
       VALUES (?, 'canary', 'passed', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z')`,
    ).run(runId, JSON.stringify(summary));
    db.prepare(
      `INSERT INTO memory_eval_results (run_id, case_id, passed, failures, metrics, tiers, retrieved, trace)
       VALUES (?, 'case-1', 1, '[]', ?, '[]', '[]', '[]')`,
    ).run(runId, JSON.stringify({ recallAtK: 1, precisionAtK: 1, mrr: 1, latencyMs: 12, tierCoverage: 1, stalenessHours: null, falsePositiveRate: 0 }));
    const latest = getLatestMemoryEvalRun(db);
    expect(latest.run?.id).toBe(runId);
    expect(latest.run?.summary.passRate).toBe(1);
    expect(latest.run?.results[0]?.caseId).toBe("case-1");
    db.close();
  });

  it("getLatestMemoryEvalRun returns null run when table empty", () => {
    const db = new Database(":memory:");
    ensureMemoryEvalTables(db);
    const latest = getLatestMemoryEvalRun(db);
    expect(latest.run).toBeNull();
    expect(latest.ok).toBe(true);
    db.close();
  });
});
