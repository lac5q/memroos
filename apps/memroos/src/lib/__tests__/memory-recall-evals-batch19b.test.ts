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
  loadMemoryRecallEvalCases,
  scoreMemoryRecallCase,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch19b — scoring thresholds and loader", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    vi.restoreAllMocks();
    ensureMemoryEvalTables(db);
    db.exec("DELETE FROM memory_eval_results");
    db.exec("DELETE FROM memory_eval_runs");
  });

  it("scoreMemoryRecallCase fails when avoided memory ids appear in top k", () => {
    const testCase: MemoryRecallEvalCase = {
      id: "avoid-id",
      layer: "gold",
      scenario: "avoid",
      agentId: "memory-eval",
      taskPrompt: "Find billing",
      expectedFacts: ["billing"],
      expectedTiers: ["vector"],
      requiredTiming: "before_plan",
      avoidMemoryIds: ["forbidden-id"],
    };
    const scored = scoreMemoryRecallCase(
      testCase,
      [
        {
          id: "forbidden-id",
          tier: "vector",
          content: "billing note",
          latencyMs: 2,
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
    );
    expect(scored.passed).toBe(false);
    expect(scored.failures).toContain("avoided memory found in top k");
  });

  it("loadMemoryRecallEvalCases reads cases from MEMORY_RECALL_EVAL_CASES_PATH", () => {
    const casesPath = path.join(os.tmpdir(), `mre-b19b-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "loaded-case",
          layer: "canary",
          scenario: "loader",
          agentId: "memory-eval",
          taskPrompt: "ping",
          expectedFacts: ["ping"],
          expectedTiers: ["vector"],
          requiredTiming: "before_final",
        },
      ]),
      "utf8",
    );
    process.env.MEMORY_RECALL_EVAL_CASES_PATH = casesPath;
    const cases = loadMemoryRecallEvalCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toBe("loaded-case");
    fs.unlinkSync(casesPath);
  });

  it("getLatestMemoryEvalRun returns ok with null run when table is empty", () => {
    const latest = getLatestMemoryEvalRun(db);
    expect(latest.ok).toBe(true);
    expect(latest.run).toBeNull();
  });
});
