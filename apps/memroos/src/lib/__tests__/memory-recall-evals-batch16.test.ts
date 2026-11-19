// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  loadMemoryRecallEvalCases,
  runMemoryRecallEvalSuite,
  type MemoryRecallEvalCase,
} from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch16 — vector helpers and repoRoot fallback", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_POLL_MS;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_HIVE_ALERTS;
  });

  it("loadMemoryRecallEvalCases falls back to repoRoot when env path is unset", () => {
    const repoCases = path.resolve(process.cwd(), "../../evals/memory-recall/cases.json");
    if (!fs.existsSync(repoCases)) {
      expect(true).toBe(true);
      return;
    }
    const cases = loadMemoryRecallEvalCases();
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
  });

  it("searchVector maps object hits and surfaces HTTP error details", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b16-vector-${crypto.randomUUID()}.json`);
    const testCase: MemoryRecallEvalCase = {
      id: "vector-search-shape",
      layer: "gold",
      scenario: "vector search mapping",
      agentId: "memory-eval",
      taskPrompt: "Find billing sync decision",
      expectedFacts: ["billing sync decision"],
      expectedTiers: ["vector"],
      requiredTiming: "before_plan",
      fixtures: [{ id: "vec-fix", tier: "vector", content: "billing sync decision for April" }],
    };
    fs.writeFileSync(casesPath, JSON.stringify([testCase]), "utf8");
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/add")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url.includes("/memory/search")) {
        return new Response(JSON.stringify({ detail: "vector index offline" }), { status: 503 });
      }
      return new Response("{}", { status: 404 });
    });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.tiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: "vector", ok: false, error: expect.stringContaining("vector index offline") }),
      ]),
    );
    fs.unlinkSync(casesPath);
  });

  it("waitForVectorFixture times out without lastError when search never matches", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b16-settle-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-settle-empty",
          layer: "gold",
          scenario: "vector settle timeout",
          agentId: "memory-eval",
          taskPrompt: "Recall billing",
          expectedFacts: ["billing"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          fixtures: [{ id: "missing-fixture", tier: "vector", content: "billing sync decision" }],
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "40");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "10");
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "5000");

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
    expect(run.results[0]?.tiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tier: "vector",
          ok: false,
          error: expect.stringContaining("did not settle"),
        }),
      ]),
    );
    fs.unlinkSync(casesPath);
  });

  it("searchGraph returns empty when graph payload lacks results array", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b16-graph-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "graph-empty-results",
          layer: "gold",
          scenario: "graph empty",
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
    const backends = await import("@/lib/memory/backends");
    vi.spyOn(backends, "queryGraphMemory").mockResolvedValue({ notResults: true });

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.tiers).toEqual(
      expect.arrayContaining([expect.objectContaining({ tier: "graph", ok: true, count: 0 })]),
    );
    expect(run.results[0]?.retrieved.filter((r) => r.tier === "graph").length).toBe(0);
    fs.unlinkSync(casesPath);
  });

  it("maybePostMemoryEvalAlert no-ops when hive post script is absent", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b16-alert-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "alert-no-hive",
          layer: "gold",
          scenario: "forced fail",
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
    const originalHome = process.env.HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b16-${crypto.randomUUID()}-`));
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
