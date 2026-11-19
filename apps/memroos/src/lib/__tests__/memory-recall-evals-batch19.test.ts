// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureMemoryEvalTables,
  getLatestMemoryEvalRun,
  hasRequiredRecallTiming,
  memoryEvalRunToAgentTrace,
  runMemoryRecallEvalSuite,
  scoreMemoryRecallCase,
  summarizeMemoryEvalRun,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch19 — helpers, persistence, agent trace bridge", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_HIVE_ALERTS;
    ensureMemoryEvalTables(db);
    db.exec("DELETE FROM memory_eval_results");
    db.exec("DELETE FROM memory_eval_runs");
    db.exec("DELETE FROM memory_eval_cases");
  });

  it("hasRequiredRecallTiming compares stage ordering", () => {
    expect(
      hasRequiredRecallTiming(
        [{ action: "memory_recall", timing: "before_tool_use", timestamp: "2026-07-01T00:00:00.000Z" }],
        "before_tool_use",
      ),
    ).toBe(true);
    expect(
      hasRequiredRecallTiming(
        [{ action: "other", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
        "before_plan",
      ),
    ).toBe(false);
  });

  it("summarizeMemoryEvalRun aggregates tier failures and empty runs", () => {
    const summary = summarizeMemoryEvalRun([
      {
        passed: true,
        metrics: { latencyMs: 10 },
        tiers: [{ tier: "vector", ok: true, latencyMs: 10, error: null }],
      },
      {
        passed: false,
        metrics: { latencyMs: 20 },
        tiers: [
          { tier: "graph", ok: false, latencyMs: 20, error: "down" },
          { tier: "vector", ok: false, latencyMs: 5, error: "down" },
        ],
      },
    ]);
    expect(summary.passRate).toBe(0.5);
    expect(summary.tierFailures.sort()).toEqual(["graph", "vector"]);
    expect(summarizeMemoryEvalRun([]).passRate).toBe(0);
  });

  it("scoreMemoryRecallCase maps numeric metadata and nested depth limits", () => {
    const testCase: MemoryRecallEvalCase = {
      id: "meta-depth",
      layer: "gold",
      scenario: "metadata depth",
      agentId: "memory-eval",
      taskPrompt: "Find token",
      expectedFacts: ["42"],
      expectedTiers: ["vector"],
      requiredTiming: "before_plan",
    };
    const scored = scoreMemoryRecallCase(
      testCase,
      [
        {
          id: "vector-0",
          tier: "vector",
          content: "value 42",
          latencyMs: 4,
          metadata: { nested: { deep: { deeper: { deepest: "42" } } }, note: "value 42" },
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
      3,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
  });

  it("getLatestMemoryEvalRun and memoryEvalRunToAgentTrace round-trip persisted runs", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b19-persist-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "persist-case",
          layer: "gold",
          scenario: "persist",
          agentId: "memory-eval",
          taskPrompt: "Recall note",
          expectedFacts: ["note"],
          expectedTiers: ["episodic"],
          requiredTiming: "before_plan",
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, 'proj', 'memory-eval', 'user', 'note content', '2026-07-01T00:00:00.000Z', 'internal', 'indexable')`,
    ).run(`sess-${crypto.randomUUID()}`);

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    ensureMemoryEvalTables(db);
    const latest = getLatestMemoryEvalRun(db);
    expect(latest.run?.id).toBe(run.id);
    const trace = memoryEvalRunToAgentTrace(run);
    expect(trace.traceId).toContain("memory-eval-bridge");
    expect(trace.memory?.retrievedFacts?.length).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });

  it("maybePostMemoryEvalAlert no-ops when hive alerts disabled", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b19-hive-off-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "hive-off",
          layer: "gold",
          scenario: "alert off",
          agentId: "memory-eval",
          taskPrompt: "Recall billing",
          expectedFacts: ["billing"],
          expectedTiers: ["graph"],
          requiredTiming: "before_plan",
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_HIVE_ALERTS", "0");
    const backends = await import("@/lib/memory/backends");
    vi.spyOn(backends, "queryGraphMemory").mockRejectedValue(new Error("graph down"));
    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.status).toBe("failed");
    fs.unlinkSync(casesPath);
  });
});
