// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { MEM0_URL } from "@/lib/constants";
import { runMemoryRecallEvalSuite } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch21 — stringify fallback, abort, vector fail reason", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS;
    delete process.env.MEMORY_EVAL_VECTOR_SETTLE_POLL_MS;
  });

  function writeCase(id: string, extra: Record<string, unknown> = {}) {
    const casesPath = path.join(os.tmpdir(), `mre-b21-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id,
          layer: "gold",
          scenario: id,
          agentId: "memory-eval",
          taskPrompt: "Recall",
          expectedFacts: ["needle-token"],
          expectedMemoryIds: ["fix-b21"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          thresholds: { recallAtK: 0, precisionAtK: 0, mrr: 0, latencyMs: 60000 },
          fixtures: [{ id: "fix-b21", tier: "vector", content: "needle-token payload" }],
          ...extra,
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);
    return casesPath;
  }

  it("searchVector JSON.stringify fallback when vector hits lack string fields", async () => {
    const casesPath = writeCase("vector-json-fallback-b21");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/memory/add")) {
          return { ok: true, json: async () => ({ status: "ok" }) } as Response;
        }
        if (url.includes("/memory/search")) {
          return {
            ok: true,
            json: async () => ({
              results: [{ nested: { only: 42 } }, { id: "fix-b21", memory: "needle-token payload" }],
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.retrieved.some((r) => r.content.includes('"nested"'))).toBe(true);
    fs.unlinkSync(casesPath);
  });

  it("fetchWithDeadline aborts hung vector search with timeout message", async () => {
    const casesPath = writeCase("vector-search-abort-b21");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SEARCH_TIMEOUT_MS", "30");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/memory/add")) {
          return { ok: true, json: async () => ({ status: "ok" }) } as Response;
        }
        if (url.includes("/memory/search")) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.tiers.some((t) => t.tier === "vector" && t.ok === false)).toBe(true);
    expect(run.results[0]?.tiers.find((t) => t.tier === "vector")?.error).toMatch(/timed out/i);
    fs.unlinkSync(casesPath);
  });

  it("seedFixture throws vector write fail reason when mem0 rejects the add", async () => {
    const casesPath = writeCase("vector-write-fail-b21");
    vi.stubEnv("MEMORY_EVAL_VECTOR_TIMEOUT_MS", "5000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `${MEM0_URL}/memory/add`) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ result: { reason: "vector shard unavailable" } }),
          } as Response;
        }
        return { ok: true, json: async () => ({ results: [] }) } as Response;
      }),
    );

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.passed).toBe(false);
    expect(run.results[0]?.tiers.some((t) => t.tier === "vector" && t.ok === false)).toBe(true);
    expect(run.results[0]?.tiers.find((t) => t.tier === "vector")?.error).toMatch(/vector shard unavailable/);
    fs.unlinkSync(casesPath);
  });
});
