// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite, scoreMemoryRecallCase } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch35 — textFromMemoryItem keys and vector write fallback", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_POLL_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS;
  });

  it("textFromMemoryItem prefers name/title fields on search hits (407)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-title-b35-${randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-title-b35",
          layer: "gold",
          scenario: "title field mapping",
          agentId: "memory-eval",
          taskPrompt: "Recall title",
          expectedFacts: ["batch35-title-token"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-title-b35", tier: "vector", content: "batch35-title-token body" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "800");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "800");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return Response.json({ status: "ok" }, { status: 200 });
      }
      if (url.includes("/memory/search")) {
        return Response.json({
          results: [{ id: "fix-title-b35", title: "batch35-title-token payload" }],
        });
      }
      return Response.json({}, { status: 404 });
    });
    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });

  it("seedFixture settles vector writes after network failure (516-520)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-fallback-b35-${randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-fallback-b35",
          layer: "gold",
          scenario: "add timeout then settle",
          agentId: "memory-eval",
          taskPrompt: "Recall after fallback",
          expectedFacts: ["fallback-marker-b35"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-fallback-b35", tier: "vector", content: "fallback-marker-b35 notes" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "50");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "400");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "40");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "400");

    let addCalls = 0;
    let searchCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        addCalls += 1;
        throw new Error("batch35 simulated add timeout");
      }
      if (url.includes("/memory/search")) {
        searchCalls += 1;
        if (searchCalls >= 2) {
          return Response.json({ results: [{ id: "fix-fallback-b35", memory: "fallback-marker-b35 notes" }] });
        }
        return Response.json({ results: [] });
      }
      return Response.json({}, { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(addCalls).toBeGreaterThan(0);
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });

  it("scoreMemoryRecallCase flags missing tier coverage (236)", () => {
    const scored = scoreMemoryRecallCase(
      {
        id: "tier-gap-b35",
        layer: "gold",
        scenario: "tier coverage",
        agentId: "memory-eval",
        taskPrompt: "Recall",
        expectedFacts: ["needle-b35"],
        expectedTiers: ["vector", "episodic"],
        requiredTiming: "before_plan",
      },
      [{ id: "only-vector", tier: "vector", content: "needle-b35", latencyMs: 5 }],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-11-12T00:00:00.000Z" }],
      3,
    );
    expect(scored.failures).toContain("missing expected tier coverage");
  });
});
