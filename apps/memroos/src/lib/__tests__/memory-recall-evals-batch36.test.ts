// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runMemoryRecallEvalSuite } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch36", () => {
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

  it("textFromMemoryItem maps content field on vector hits (407)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-content-b36-${randomUUID()}.json`);
    const token = `content-token-b36-${randomUUID().slice(0, 8)}`;
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-content-b36",
          layer: "gold",
          scenario: "content field mapping",
          agentId: "memory-eval",
          taskPrompt: "Recall content",
          expectedFacts: [token],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-content-b36", tier: "vector", content: `${token} body` }],
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
          results: [{ id: "fix-content-b36", content: `${token} payload` }],
        });
      }
      return Response.json({}, { status: 404 });
    });
    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });

  it("seedFixture waits for vector settlement when add returns queued (516-520)", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-queued-b36-${randomUUID()}.json`);
    const token = `queued-marker-b36-${randomUUID().slice(0, 8)}`;
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-queued-b36",
          layer: "gold",
          scenario: "queued write then settle",
          agentId: "memory-eval",
          taskPrompt: "Recall after queue",
          expectedFacts: [token],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "fix-queued-b36", tier: "vector", content: `${token} notes` }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "800");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "500");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "40");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "500");
    let searchCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return Response.json({ status: "queued" }, { status: 200 });
      }
      if (url.includes("/memory/search")) {
        searchCalls += 1;
        if (searchCalls >= 2) {
          return Response.json({ results: [{ id: "fix-queued-b36", memory: `${token} notes` }] });
        }
        return Response.json({ results: [] });
      }
      return Response.json({}, { status: 404 });
    });
    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(searchCalls).toBeGreaterThanOrEqual(2);
    expect(run.results[0]?.metrics.recallAtK).toBeGreaterThan(0);
    fs.unlinkSync(casesPath);
  });
});
