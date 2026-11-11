// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { MEM0_URL } from "@/lib/constants";
import { loadMemoryRecallEvalCases, runMemoryRecallEvalSuite } from "@/lib/memory-recall-evals";

describe("memory-recall-evals batch20 — vector item normalization and abort paths", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
  });

  it("runMemoryRecallEvalSuite maps heterogeneous vector search payloads", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b20-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        {
          id: "vector-shape-b20",
          layer: "gold",
          scenario: "vector shapes",
          agentId: "memory-eval",
          taskPrompt: "Find content",
          fixtures: [{ id: "fixture-title", tier: "vector", content: "title field content" }],
          expectedFacts: ["title field content"],
          expectedMemoryIds: ["fixture-title"],
          expectedTiers: ["vector"],
          requiredTiming: "before_plan",
          thresholds: { recallAtK: 0, precisionAtK: 0, mrr: 0, latencyMs: 60000 },
        },
      ]),
      "utf8",
    );
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", casesPath);

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
              results: [
                { title: "title field content" },
                "plain-string-hit",
                { id: "fixture-title", memory: "title field content" },
              ],
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.passed).toBe(true);
    expect(run.results[0]?.retrieved.some((r) => r.content.includes("plain-string"))).toBe(true);
    fs.unlinkSync(casesPath);
  });

  it("loadMemoryRecallEvalCases reads bundled catalog from repo root", () => {
    const cases = loadMemoryRecallEvalCases();
    expect(cases.length).toBeGreaterThan(0);
  });
});
