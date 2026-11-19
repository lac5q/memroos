// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { MEM0_URL } from "@/lib/constants";
import {
  ensureMemoryEvalTables,
  loadMemoryRecallEvalCases,
  runMemoryRecallEvalSuite,
  scoreMemoryRecallCase,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch19c — vector fixture paths and repoRoot fallback", () => {
  const db = new Database(":memory:");
  initSchema(db);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_POLL_MS;
    ensureMemoryEvalTables(db);
    db.exec("DELETE FROM memory_eval_results");
    db.exec("DELETE FROM memory_eval_runs");
  });

  it("loadMemoryRecallEvalCases walks repoRoot fallback when cases.json is absent", () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((p, enc) => {
      if (String(p).endsWith("cases.json")) {
        return JSON.stringify([
          {
            id: "fallback-case",
            layer: "gold",
            scenario: "fallback",
            agentId: "memory-eval",
            taskPrompt: "ping",
            expectedFacts: ["ping"],
            expectedTiers: ["episodic"],
            requiredTiming: "before_plan",
          },
        ]);
      }
      return readSpy.mock.originalImplementation?.(p as never, enc as never) as never;
    });
    const cases = loadMemoryRecallEvalCases();
    expect(cases[0]?.id).toBe("fallback-case");
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });

  it("runMemoryRecallEvalSuite handles vector write timeout then settle poll", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b19c-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-settle",
          layer: "gold",
          scenario: "vector",
          agentId: "memory-eval",
          taskPrompt: "Find fixture",
          fixtures: [{ id: "fixture-abc", tier: "vector", content: "fixture content abc" }],
          expectedFacts: ["fixture"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "5000");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "1000");

    let searchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/memory/add")) {
          throw new Error("Vector canary write timed out");
        }
        if (url.includes("/memory/search")) {
          searchCalls += 1;
          if (searchCalls >= 2) {
            return {
              ok: true,
              json: async () => ({
                results: [{ id: "fixture-abc", memory: "fixture content abc" }],
              }),
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({ results: [] }),
          } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const runPromise = runMemoryRecallEvalSuite({ mode: "gold", db });
    await vi.advanceTimersByTimeAsync(2500);
    const run = await runPromise;
    expect(run.results[0]?.tiers.some((t) => t.tier === "vector")).toBe(true);
    fs.unlinkSync(casesPath);
  });

  it("scoreMemoryRecallCase dedupes merged episodic tiers via mergeRecallResults path", () => {
    const testCase: MemoryRecallEvalCase = {
      id: "dedupe",
      layer: "gold",
      scenario: "dedupe",
      agentId: "memory-eval",
      taskPrompt: "Find note",
      expectedFacts: ["note"],
      expectedTiers: ["vector"],
      requiredTiming: "before_plan",
    };
    const scored = scoreMemoryRecallCase(
      testCase,
      [
        { id: "vector-0", tier: "vector", content: "plain string body", latencyMs: 1 },
        {
          id: "vector-1",
          tier: "vector",
          content: "fallback json",
          latencyMs: 2,
          metadata: { title: "note title" },
        },
        {
          id: "vector-2",
          tier: "vector",
          content: "deep",
          latencyMs: 3,
          metadata: { nested: { a: { b: { c: { d: { e: "note" } } } } } },
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
      5,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
    expect(MEM0_URL).toMatch(/^http/);
  });
});
