// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashScopeIdentity, normalizeScopeIdentity } from "@/lib/msiq/scope-identity";
import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "@/lib/retrieval-bench/runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch23b — ignored synthesis and audit gaps", () => {
  it("synthesizes ignored entries for denied and stale pipeline items", async () => {
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("scope");
    const scopeHash = hashScopeIdentity(normalized);
    const rerankMod = await import("../modules/rerank");
    vi.spyOn(rerankMod, "rerankCandidates").mockResolvedValueOnce({
      items: [
        {
          id: "denied-b23b",
          score: 99,
          text: "denied",
          tier: "live",
          source: "live",
          authorizationResult: "denied",
          whyEntered: "test",
          scopeHash,
          rankPosition: 1,
        },
        {
          id: "stale-b23b",
          score: 98,
          text: "stale",
          tier: "live",
          source: "live",
          authorizationResult: "allowed",
          whyEntered: "test",
          scopeHash,
          rankPosition: 2,
          stale: true,
          reason: "policy_stale",
        },
      ],
      receipt: { strategy: "provider", cutoff: 2, inputCount: 2, outputCount: 2 },
    });

    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 4,
      seed: 11,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "ignored" && s.ids.length > 0)).toBe(true);
    expect(stages.some((s) => s.stage === "denied" && s.ids.includes("denied-b23b"))).toBe(true);
  });

  it("withAudit false keeps run audit persistence null", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 2,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      withAudit: false,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.run).toBeNull();
  });
});
