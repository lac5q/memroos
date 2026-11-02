// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  scoreMemoryRecallCase,
  memoryEvalRunToAgentTrace,
  runMemoryRecallEvalSuite,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";
import { initSchema } from "@/lib/db-schema";

describe("memory-recall-evals batch15 — scoring helpers and episodic suite", () => {
  it("scoreMemoryRecallCase reads string-shaped retrieved metadata via content keys", () => {
    const testCase: MemoryRecallEvalCase = {
      id: "case-string-item",
      layer: "canary",
      scenario: "unit",
      agentId: "agent-1",
      taskPrompt: "recall budget memo",
      expectedFacts: ["budget memo"],
      expectedTiers: ["episodic"],
      requiredTiming: "before_final",
      fixtures: [],
    };
    const scored = scoreMemoryRecallCase(
      testCase,
      [
        {
          id: "1",
          tier: "episodic",
          content: "budget memo from last week",
          latencyMs: 5,
          metadata: "plain-string-metadata",
        },
      ],
      [{ action: "memory_recall", timing: "before_final", timestamp: "t1" }],
    );
    expect(scored.passed).toBe(true);
  });

  it("memoryEvalRunToAgentTrace maps aggregate metrics into agent eval trace", () => {
    const trace = memoryEvalRunToAgentTrace({
      id: "run-1",
      mode: "canary",
      status: "passed",
      startedAt: "t0",
      completedAt: "t1",
      summary: {
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        passRate: 1,
        p95LatencyMs: 10,
        tierFailures: [],
      },
      results: [
        {
          caseId: "c1",
          agentId: "a1",
          layer: "canary",
          scenario: "s",
          taskPrompt: "p",
          passed: true,
          failures: [],
          metrics: {
            recallAtK: 1,
            precisionAtK: 1,
            mrr: 1,
            latencyMs: 10,
            tierCoverage: 1,
            stalenessHours: null,
            falsePositiveRate: 0,
          },
          tiers: [{ tier: "episodic", ok: true, count: 1 }],
          retrieved: [{ id: "1", tier: "episodic", content: "hello world", latencyMs: 1 }],
          trace: [],
        },
      ],
    });
    expect(trace.memory?.recallAtK).toBe(1);
    expect(trace.outcome.completed).toBe(true);
  });

  it("runMemoryRecallEvalSuite executes episodic-only cases from temp fixtures file", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const casesPath = path.join(os.tmpdir(), `memory-recall-b15-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "episodic-canary",
          layer: "canary",
          scenario: "keyword recall",
          agentId: "memory-eval",
          taskPrompt: "What was decided about checkout?",
          expectedFacts: ["checkout"],
          expectedMemoryIds: [],
          expectedTiers: ["episodic"],
          requiredTiming: "before_final",
          fixtures: [
            {
              id: "fix-1",
              tier: "episodic",
              content: "We decided checkout should use Stripe.",
              metadata: {},
            },
          ],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    const run = await runMemoryRecallEvalSuite({ mode: "canary", db });
    expect(run.results.length).toBe(1);
    fs.unlinkSync(casesPath);
    db.close();
    vi.unstubAllEnvs();
  });
});
