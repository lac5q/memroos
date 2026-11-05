// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  runMemoryRecallEvalSuite,
  scoreMemoryRecallCase,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch17 — graph mapping and scoring helpers", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
  });

  it("scoreMemoryRecallCase reads object-shaped retrieved entries", () => {
    const testCase: MemoryRecallEvalCase = {
      id: "object-hit",
      layer: "gold",
      scenario: "object mapping",
      agentId: "memory-eval",
      taskPrompt: "Find billing",
      expectedFacts: ["billing sync"],
      expectedTiers: ["graph"],
      requiredTiming: "before_plan",
    };
    const scored = scoreMemoryRecallCase(
      testCase,
      [
        {
          id: "graph-0",
          tier: "graph",
          content: "billing sync decision",
          latencyMs: 12,
          metadata: { memory: "billing sync decision detail" },
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
      5,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
    expect(scored.passed).toBe(true);
  });

  it("runMemoryRecallEvalSuite maps graph object hits via textFromMemoryItem", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b17-graph-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "graph-object-hit",
          layer: "gold",
          scenario: "graph object",
          agentId: "memory-eval",
          taskPrompt: "Recall billing",
          expectedFacts: ["billing sync"],
          expectedTiers: ["graph"],
          requiredTiming: "before_plan",
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    const backends = await import("@/lib/memory/backends");
    vi.spyOn(backends, "queryGraphMemory").mockResolvedValue({
      results: [{ title: "billing sync decision record" }],
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    const graphHits = run.results[0]?.retrieved.filter((r) => r.tier === "graph") ?? [];
    expect(graphHits[0]?.content).toContain("billing sync");
    fs.unlinkSync(casesPath);
  });

  it("runMemoryRecallEvalSuite dedupes merged recall results by tier and id", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b17-merge-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "episodic-dedupe",
          layer: "gold",
          scenario: "merge dedupe",
          agentId: "memory-eval",
          taskPrompt: "Recall note",
          expectedFacts: ["shared note"],
          expectedTiers: ["episodic"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-1", tier: "episodic", content: "shared note content" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, 'proj', 'memory-eval', 'user', 'shared note content', '2026-07-01T00:00:00.000Z', 'internal', 'indexable')`,
    ).run(`sess-${crypto.randomUUID()}`);

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    const episodic = run.results[0]?.retrieved.filter((r) => r.tier === "episodic") ?? [];
    const keys = new Set(episodic.map((r) => `${r.tier}:${r.id}`));
    expect(keys.size).toBe(episodic.length);
    fs.unlinkSync(casesPath);
  });
});
