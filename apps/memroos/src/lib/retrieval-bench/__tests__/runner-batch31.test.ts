// @vitest-environment node
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashScopeIdentity, normalizeScopeIdentity } from "@/lib/msiq/scope-identity";
import { resolveFromRepoRoot } from "@/lib/paths";

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
  maxFreshnessSeconds: 60,
};

afterEach(() => {
  vi.doUnmock("../modules/context-pack");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch31 — ignored union and audit branches", () => {
  it("maps pack.omitted into ignored when absent from result.ignored (L781)", async () => {
    const omittedId = `omitted-b31-${crypto.randomUUID().slice(0, 8)}`;
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            omitted: [{ id: omittedId, reason: "over_rank_budget" }, ...base.omitted],
          };
        },
      };
    });
    vi.resetModules();
    const { runBenchmark } = await import("../runner");

    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 31,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const taskId = run.report.tasks[0]?.taskId;
    expect(taskId).toBeDefined();
    if (!taskId) return;
    const ignoredStage = run.pipeline?.perTaskStageRecords.get(taskId)?.find((s) => s.stage === "ignored");
    expect(ignoredStage?.ids).toContain(omittedId);
  });

  it("live ignored synthesis records stale policy reason codes (L783–791)", async () => {
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    expect(normalized).toBeTruthy();
    if (!normalized) return;
    const scopeHash = hashScopeIdentity(normalized);
    const rerankMod = await import("../modules/rerank");
    vi.spyOn(rerankMod, "rerankCandidates").mockResolvedValueOnce({
      items: [
        {
          id: "stale-corpus-b31",
          score: 99,
          text: "stale fact",
          tier: "live",
          source: "live",
          authorizationResult: "stale",
          whyEntered: "batch31",
          scopeHash,
          rankPosition: 1,
        },
      ],
      receipt: { strategy: "provider", cutoff: 1, inputCount: 1, outputCount: 1 },
    });

    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 3,
      seed: 31,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const taskId = run.report.tasks[0]?.taskId;
    const stages = run.pipeline?.perTaskStageRecords.get(taskId ?? "") ?? [];
    expect(stages.some((s) => s.stage === "stale" && s.ids.includes("stale-corpus-b31"))).toBe(true);
    const ignoredStage = stages.find((s) => s.stage === "ignored");
    expect(ignoredStage?.ids).toContain("stale-corpus-b31");
  });

  /**
   * `strongestFailure` lines 451–453 (`!o` → missing_audit_outcome) have no
   * production caller that passes sparse/falsy outcome slots.
   */
  it.skip("strongestFailure missing_audit_outcome (!o at 451–453) — no live path", () => {});
});
