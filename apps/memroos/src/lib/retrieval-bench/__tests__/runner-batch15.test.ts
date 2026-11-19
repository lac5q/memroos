// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { hashScopeIdentity, normalizeScopeIdentity } from "@/lib/msiq/scope-identity";
import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark, renderTextReport } from "../runner";
import type { AggregateReport, RetrievedItem } from "../schema";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

describe("retrieval-bench runner batch15 — gates and pipeline edges", () => {
  it("returns fixture_validation_failed when loaded tasks fail validation", async () => {
    vi.doMock("../adapters/synthetic", () => ({
      loadSyntheticSmoke: () => ({
        ok: true,
        tasks: [
          {
            id: "dup",
            dataset: "memroos_public_synthetic",
            task_type: "single_hop",
            corpus: ["not-an-object"],
            question: "q?",
            expected_answer: "a",
            license: "MIT",
            citation: "c",
            provenance: {
              sourceCitation: "synthetic",
              sourceLicense: "MIT",
              sourceAvailability: "synthetic",
            },
          },
        ],
        truncated: false,
        totalAvailable: 1,
      }),
    }));
    vi.resetModules();
    const { runBenchmark: runWithBadFixtures } = await import("../runner");
    const result = await runWithBadFixtures({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      limit: 1,
    });
    vi.doUnmock("../adapters/synthetic");
    vi.resetModules();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("fixture_validation_failed");
  });

  it("returns adapter_not_registered for unknown adapter names", async () => {
    const result = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "nonexistent-adapter-name",
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      limit: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/adapter_not_registered/);
  });

  it("returns lane_assignment_invalid when lane registry drifts", async () => {
    vi.doMock("../lanes", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../lanes")>();
      return {
        ...actual,
        verifyLaneAssignments: () => ({ ok: false, mismatches: ["gold lane drift"] }),
      };
    });
    vi.resetModules();
    const { runBenchmark: runWithBadLanes } = await import("../runner");
    const result = await runWithBadLanes({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      limit: 1,
    });
    vi.doUnmock("../lanes");
    vi.resetModules();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("lane_assignment_invalid");
  });

  it("live pipeline marks fanout-only candidates as unverified when adapter did not authorize them", async () => {
    const LIVE_SCOPE = {
      tenantId: "benchmark-tenant",
      userId: "benchmark-user",
      agentId: "benchmark-agent",
      spaceId: "benchmark-space",
      label: {
        visibility: "internal" as const,
        policy: "agent_visible" as const,
        domain: "benchmark",
        sensitivity: null,
      },
      purpose: "memory_search" as const,
      beliefStage: "silver_candidate_claim" as const,
    };
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("scope");
    const scopeHash = hashScopeIdentity(normalized);
    const rogueFanout: RetrievedItem = {
      id: "rogue-fanout",
      score: 99,
      text: "rogue",
      tier: "live",
      source: "fanout",
      authorizationResult: "allowed",
      whyEntered: "test",
      scopeHash,
      rankPosition: 99,
    };
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 2,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      fanoutItemsForTest: [rogueFanout],
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const stages = run.pipeline?.perTaskStageRecords.get(run.report.tasks[0]!.taskId) ?? [];
    expect(stages.some((s) => s.stage === "denied" && s.ids.includes("rogue-fanout"))).toBe(true);
  });

  it("renderTextReport includes token and context pack metric lines", () => {
    const report = {
      runId: "run-1",
      runDate: "2026-01-01",
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      lane: "gold",
      k: 3,
      rerankEnabled: false,
      judgeEnabled: false,
      seed: 0,
      taskCount: 1,
      fixtureHash: "sha256:fixture",
      configHash: "sha256:config",
      aggregate: {
        taskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        precisionAtK: 1,
        recallAtK: 1,
        mrr: 1,
        falsePositiveRate: 0,
        answerSupportedRate: 1,
        p95LatencyMs: 1,
        abstentionAccuracy: null,
        abstentionLabeledCount: null,
        abstentionAnswerableFailureCount: null,
        contextPackBytes: 128,
        contextPackHash: "sha256:pack-b15",
        tokensRetrieval: 4,
        tokensRerank: 2,
        tokensPack: 1,
        tokensJudge: 3,
        laneMetrics: {},
      },
      tasks: [],
    } as unknown as AggregateReport;
    const text = renderTextReport(report);
    expect(text).toContain("context_pack_hash");
    expect(text).toContain("tokens_judge");
  });
});
