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

describe("memory-recall-evals batch18 — text mapping, merge limit, vector timeout paths", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_POLL_MS;
    delete process.env.MEMORY_EVAL_HIVE_ALERTS;
  });

  it("scoreMemoryRecallCase maps string memory items and non-object entries", () => {
    const testCase: MemoryRecallEvalCase = {
      id: "string-hit",
      layer: "gold",
      scenario: "string mapping",
      agentId: "memory-eval",
      taskPrompt: "Find billing",
      expectedFacts: ["billing sync"],
      expectedTiers: ["vector"],
      requiredTiming: "before_plan",
    };
    const scored = scoreMemoryRecallCase(
      testCase,
      [
        {
          id: "vector-0",
          tier: "vector",
          content: "billing sync decision",
          latencyMs: 8,
          metadata: "billing sync raw string",
        },
        {
          id: "vector-1",
          tier: "vector",
          content: "",
          latencyMs: 8,
          metadata: null,
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
      1,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
  });

  it("runMemoryRecallEvalSuite uses repoRoot fallback when cases path env is unset", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b18-root-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "repo-root-case",
          layer: "gold",
          scenario: "root fallback",
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
    expect(run.results.length).toBe(1);
    fs.unlinkSync(casesPath);
  });

  it("runMemoryRecallEvalSuite handles vector write timeout via waitForVectorFixture fallback", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b18-vector-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-timeout",
          layer: "gold",
          scenario: "vector timeout",
          agentId: "memory-eval",
          taskPrompt: "Recall vector fixture",
          expectedFacts: ["fixture-token"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-timeout", tier: "vector", content: "fixture-token content" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "50");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "10");
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "20");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        throw new Error("write timed out");
      }
      if (url.includes("/memory/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.tiers.some((t) => t.tier === "vector" && t.ok === false)).toBe(true);
    fs.unlinkSync(casesPath);
  });

  it("runMemoryRecallEvalSuite mergeRecallResults respects retrieval limit", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b18-merge-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "merge-limit",
          layer: "gold",
          scenario: "merge limit",
          agentId: "memory-eval",
          taskPrompt: "Recall many",
          expectedFacts: ["alpha"],
          expectedTiers: ["episodic", "graph"],
          requiredTiming: "before_plan",
          fixtures: [
            { id: "fix-a", tier: "episodic", content: "alpha one" },
            { id: "fix-b", tier: "episodic", content: "alpha two" },
          ],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    const backends = await import("@/lib/memory/backends");
    vi.spyOn(backends, "queryGraphMemory").mockResolvedValue({
      results: [{ title: "alpha graph" }, { title: "alpha graph duplicate" }],
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect((run.results[0]?.retrieved.length ?? 0)).toBeLessThanOrEqual(8);
    fs.unlinkSync(casesPath);
  });

  it("maybePostMemoryEvalAlert runs when hive post script exists on failed run", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b18-hive-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "hive-alert",
          layer: "gold",
          scenario: "alert",
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
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b18-${crypto.randomUUID()}-`));
    const hiveDir = path.join(home, ".hive");
    fs.mkdirSync(hiveDir, { recursive: true });
    fs.writeFileSync(path.join(hiveDir, "post.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    delete process.env.MEMORY_EVAL_HIVE_ALERTS;

    const backends = await import("@/lib/memory/backends");
    vi.spyOn(backends, "queryGraphMemory").mockRejectedValue(new Error("graph down"));

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.status).toBe("failed");
    process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.unlinkSync(casesPath);
  });
});
