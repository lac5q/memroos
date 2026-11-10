// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite, scoreMemoryRecallCase } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch30 — textFromMemoryItem, withDeadline, seedFixture json", () => {
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

  it("scoreMemoryRecallCase ignores non-object metadata (407)", () => {
    const scored = scoreMemoryRecallCase(
      {
        id: "batch30-null-meta",
        layer: "gold",
        scenario: "null metadata",
        agentId: "memory-eval",
        taskPrompt: "Find token",
        expectedFacts: ["batch30-token"],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
      },
      [
        {
          id: "vector-0",
          tier: "vector",
          content: "batch30-token payload",
          latencyMs: 2,
          metadata: undefined,
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-11-07T00:00:00.000Z" }],
      3,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
  });

  it("runMemoryRecallEvalSuite maps vector search hits via name-only memory items (407)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b30-search-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-name-field",
          layer: "gold",
          scenario: "name field mapping",
          agentId: "memory-eval",
          taskPrompt: "Recall launch",
          expectedFacts: ["launch batch30"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-b30", tier: "vector", content: "launch batch30 notes" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "500");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "500");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url.includes("/memory/search")) {
        return new Response(
          JSON.stringify({
            results: [{ name: "launch batch30 marker", id: "fix-b30" }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });

  it("seedFixture times out vector add response json (433, 516)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b30-json-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-json-timeout",
          layer: "gold",
          scenario: "json timeout",
          agentId: "memory-eval",
          taskPrompt: "Recall fixture",
          expectedFacts: ["json-timeout-token"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-json", tier: "vector", content: "json-timeout-token body" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "800");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "80");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "15");

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise(() => undefined),
        } as Response);
      }
      if (url.includes("/memory/search")) {
        return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.tiers.some((t) => t.tier === "vector")).toBe(true);
    fs.unlinkSync(casesPath);
  });
});
