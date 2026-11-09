// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite, scoreMemoryRecallCase } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch31b", () => {
  it("textFromMemoryItem ignores non-object metadata (line 407)", () => {
    const scored = scoreMemoryRecallCase(
      {
        id: "batch31b-null-meta",
        layer: "gold",
        scenario: "null metadata",
        agentId: "memory-eval",
        taskPrompt: "Find token",
        expectedFacts: ["batch31b-token"],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
      },
      [
        {
          id: "vector-0",
          tier: "vector",
          content: "batch31b-token payload",
          latencyMs: 2,
          metadata: null as unknown as undefined,
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-11-08T00:00:00.000Z" }],
      3,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
  });
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

  it("seedFixture tolerates slow /memory/add JSON via withDeadline (line 516)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b31b-${randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-slow-json-b31b",
          layer: "gold",
          scenario: "slow json body",
          agentId: "memory-eval",
          taskPrompt: "Recall batch31b",
          expectedFacts: ["batch31b marker"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-b31b", tier: "vector", content: "batch31b marker notes" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "5000");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "500");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return {
          ok: true,
          json: () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ status: "ok" }), 80);
            }),
        } as Response;
      }
      if (url.includes("/memory/search")) {
        return Response.json({ results: [{ id: "fix-b31b", memory: "batch31b marker notes" }] });
      }
      return Response.json({}, { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });
});
