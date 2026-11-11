// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch34 — textFromMemoryItem and queued vector fixtures", () => {
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

  it("textFromMemoryItem reads summary field on vector search hits (407)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-summary-b34-${randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-summary-b34",
          layer: "gold",
          scenario: "summary field mapping",
          agentId: "memory-eval",
          taskPrompt: "Recall summary",
          expectedFacts: ["batch34-summary-token"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-summary-b34", tier: "vector", content: "batch34-summary-token body" }],
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
          results: [{ id: "fix-summary-b34", summary: "batch34-summary-token payload" }],
        });
      }
      return Response.json({}, { status: 404 });
    });
    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });

  it("seedFixture waits for queued vector writes (516–520)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b34-${randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-queued-b34",
          layer: "gold",
          scenario: "queued add",
          agentId: "memory-eval",
          taskPrompt: "Recall queued",
          expectedFacts: ["queued-marker-b34"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-queued-b34", tier: "vector", content: "queued-marker-b34 notes" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "5000");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "300");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "40");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "500");

    let searchCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return Response.json({ status: "queued" }, { status: 202 });
      }
      if (url.includes("/memory/search")) {
        searchCalls += 1;
        if (searchCalls >= 2) {
          return Response.json({ results: [{ id: "fix-queued-b34", memory: "queued-marker-b34 notes" }] });
        }
        return Response.json({ results: [] });
      }
      return Response.json({}, { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });
});
