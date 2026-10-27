// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureMemoryEvalTables,
  getLatestMemoryEvalRun,
  summarizeMemoryEvalRun,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";

const db = new Database(":memory:");
initSchema(db);
ensureMemoryEvalTables(db);

afterEach(() => {
  db.exec("DELETE FROM memory_eval_results");
  db.exec("DELETE FROM memory_eval_runs");
});

describe("memory-recall-evals batch16c — summaries and latest run", () => {
  it("summarizeMemoryEvalRun aggregates tier failures and pass rate", () => {
    const summary = summarizeMemoryEvalRun([
      {
        passed: true,
        metrics: { latencyMs: 10 },
        tiers: [{ tier: "vector", ok: true, count: 1 }],
      },
      {
        passed: false,
        metrics: { latencyMs: 90 },
        tiers: [
          { tier: "graph", ok: false, count: 0, error: "offline" },
          { tier: "vector", ok: true, count: 1 },
        ],
      },
    ]);
    expect(summary.totalCases).toBe(2);
    expect(summary.passedCases).toBe(1);
    expect(summary.passRate).toBe(0.5);
    expect(summary.tierFailures).toEqual(["graph"]);
    expect(summary.p95LatencyMs).toBe(90);
  });

  it("getLatestMemoryEvalRun returns null run when table is empty", () => {
    ensureMemoryEvalTables(db);
    const latest = getLatestMemoryEvalRun(db);
    expect(latest.ok).toBe(true);
    expect(latest.run).toBeNull();
  });

  it("getLatestMemoryEvalRun hydrates stored run rows", () => {
    ensureMemoryEvalTables(db);
    const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO memory_eval_runs (id, mode, status, summary, started_at, completed_at)
       VALUES (?, 'gold', 'passed', ?, ?, ?)`,
    ).run(
      runId,
      JSON.stringify({ totalCases: 1, passedCases: 1, failedCases: 0, passRate: 1, p95LatencyMs: 5, tierFailures: [] }),
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:01.000Z",
    );
    const testCase: MemoryRecallEvalCase = {
      id: "case-1",
      layer: "gold",
      scenario: "s",
      agentId: "memory-eval",
      taskPrompt: "t",
      expectedFacts: ["fact"],
      expectedTiers: ["vector"],
      requiredTiming: "before_plan",
    };
    db.prepare(
      `INSERT INTO memory_eval_results (run_id, case_id, passed, failures, metrics, tiers, retrieved, trace)
       VALUES (?, ?, 1, '[]', ?, '[]', '[]', '[]')`,
    ).run(runId, testCase.id, JSON.stringify({ recallAtK: 1, precisionAtK: 1, mrr: 1, latencyMs: 5, tierCoverage: 1, stalenessHours: null, falsePositiveRate: 0 }));

    const latest = getLatestMemoryEvalRun(db);
    expect(latest.run?.id).toBe(runId);
    expect(latest.run?.results).toHaveLength(1);
    expect(latest.run?.results[0]?.passed).toBe(true);
  });
});
