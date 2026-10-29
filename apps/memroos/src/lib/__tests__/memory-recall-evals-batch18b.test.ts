// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite, scoreMemoryRecallCase } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch18b — text keys, graph shape, vector queued write", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_POLL_MS;
  });

  it("scoreMemoryRecallCase reads title and summary fields from metadata objects", () => {
    const scored = scoreMemoryRecallCase(
      {
        id: "title-summary",
        layer: "gold",
        scenario: "metadata keys",
        agentId: "memory-eval",
        taskPrompt: "Find launch",
        expectedFacts: ["launch"],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
      },
      [
        {
          id: "vector-0",
          tier: "vector",
          content: "",
          latencyMs: 3,
          metadata: { title: "launch checklist", summary: "ignored when title present" },
        },
      ],
      [{ action: "memory_recall", timing: "before_plan", timestamp: "2026-07-01T00:00:00.000Z" }],
      5,
    );
    expect(scored.metrics.recallAtK).toBeGreaterThan(0);
  });

  it("runMemoryRecallEvalSuite handles queued vector writes by waiting for search settlement", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b18b-queued-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-queued",
          layer: "gold",
          scenario: "queued vector write",
          agentId: "memory-eval",
          taskPrompt: "Recall queued fixture",
          expectedFacts: ["queued-token"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-queued", tier: "vector", content: "queued-token payload" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "200");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "20");
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "200");

    let searchCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return new Response(JSON.stringify({ status: "queued" }), { status: 200 });
      }
      if (url.includes("/memory/search")) {
        searchCalls += 1;
        if (searchCalls >= 2) {
          return new Response(
            JSON.stringify({ results: [{ id: "fix-queued", memory: "queued-token payload" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.trace.some((event) => event.action === "memory_write")).toBe(true);
    fs.unlinkSync(casesPath);
  });

  it("runMemoryRecallEvalSuite tolerates non-object graph payloads during recall", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b18b-graph-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "graph-null",
          layer: "gold",
          scenario: "graph null payload",
          agentId: "memory-eval",
          taskPrompt: "Recall graph",
          expectedFacts: ["graph-note"],
          expectedTiers: ["graph"],
          requiredTiming: "before_plan",
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    const backends = await import("@/lib/memory/backends");
    vi.spyOn(backends, "queryGraphMemory").mockResolvedValue(null);

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results.length).toBe(1);
    fs.unlinkSync(casesPath);
  });
});
