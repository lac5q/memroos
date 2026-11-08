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

describe("memory-recall-evals batch29 — merge cap, text stringify, deadlines", () => {
  const db = new Database(":memory:");
  initSchema(db);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.MEMORY_RECALL_EVAL_CASES_PATH;
    delete process.env.MEMORY_EVAL_VECTOR_TIMEOUT_MS;
  });

  function writeCases(pathStr: string, cases: unknown[]) {
    fs.writeFileSync(pathStr, JSON.stringify(cases), "utf8");
    vi.stubEnv("MEMORY_RECALL_EVAL_CASES_PATH", pathStr);
  }

  it("mergeRecallResults stops after dedupe when episodic fanout exceeds merge limit", async () => {
    const agentId = "memory-eval";
    const base = new Date("2026-11-06T10:00:00.000Z").getTime();
    for (let i = 0; i < 6; i += 1) {
      const ts = new Date(base + i * 1000).toISOString();
      db.prepare(
        `INSERT INTO messages
        (session_id, project, agent_id, role, content, timestamp, request_id, visibility, policy)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(`sess-b29-${i}`, "memory-eval", agentId, "assistant", `batch29wide token ${i} shared`, ts, `req-b29-${i}`, "internal", "indexable");
    }

    const casesPath = path.join(os.tmpdir(), `mre-b29-merge-${crypto.randomUUID()}.json`);
    writeCases(casesPath, [
      {
        id: "episodic-merge-b29",
        layer: "gold",
        scenario: "merge",
        agentId,
        taskPrompt: "Recall wide",
        expectedFacts: ["batch29wide"],
        expectedMemoryIds: [],
        expectedTiers: ["episodic"],
        requiredTiming: "before_plan",
        thresholds: { recallAtK: 0, precisionAtK: 0, mrr: 0, latencyMs: 60000 },
        fixtures: [],
      },
    ]);

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    const episodicTier = run.results[0]?.tiers.find((t) => t.tier === "episodic");
    expect(episodicTier?.ok).toBe(true);
    expect(run.results[0]?.retrieved.filter((r) => r.tier === "episodic").length).toBeLessThanOrEqual(5);
    fs.unlinkSync(casesPath);
  });

  it("textFromMemoryItem uses JSON.stringify when vector result objects lack string fields", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b29-str-${crypto.randomUUID()}.json`);
    writeCases(casesPath, [
      {
        id: "vector-stringify-b29",
        layer: "gold",
        scenario: "stringify",
        agentId: "memory-eval",
        taskPrompt: "Recall",
        expectedFacts: ["needle-b29"],
        expectedMemoryIds: [],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
        thresholds: { recallAtK: 0, precisionAtK: 0, mrr: 0, latencyMs: 60000 },
        fixtures: [{ id: "fix-b29", tier: "vector", content: "needle-b29 payload" }],
      },
    ]);

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
              results: [{ onlyNumber: 42 }],
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.retrieved.some((r) => r.content.includes("onlyNumber"))).toBe(true);
    fs.unlinkSync(casesPath);
  });

  it("seedFixture uses waitForVectorFixture when mem0 /memory/add network fails", async () => {
    const casesPath = path.join(os.tmpdir(), `mre-b29-net-${crypto.randomUUID()}.json`);
    writeCases(casesPath, [
      {
        id: "vector-net-b29",
        layer: "gold",
        scenario: "network",
        agentId: "memory-eval",
        taskPrompt: "Recall",
        expectedFacts: ["net-b29"],
        expectedMemoryIds: ["net-b29-fix"],
        expectedTiers: ["vector"],
        requiredTiming: "before_plan",
        thresholds: { recallAtK: 0, precisionAtK: 0, mrr: 0, latencyMs: 60000 },
        fixtures: [{ id: "net-b29-fix", tier: "vector", content: "net-b29 unique content" }],
      },
    ]);

    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_TIMEOUT_MS", "2000");
    vi.stubEnv("MEMORY_EVAL_VECTOR_SETTLE_POLL_MS", "50");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `${MEM0_URL}/memory/add`) {
          throw new Error("ECONNREFUSED localhost mem0");
        }
        if (url.includes("/memory/search")) {
          return {
            ok: true,
            json: async () => ({
              results: [{ id: "net-b29-fix", memory: "net-b29 unique content" }],
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );

    const run = await runMemoryRecallEvalSuite({ mode: "gold", db });
    expect(run.results[0]?.trace.some((t) => t.tier === "vector" && t.action === "memory_write")).toBe(true);
    fs.unlinkSync(casesPath);
  });
});
