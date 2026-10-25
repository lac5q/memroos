// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashScopeIdentity, normalizeScopeIdentity } from "@/lib/msiq/scope-identity";
import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";
import type { RetrievedItem } from "../schema";

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

describe("retrieval-bench runner batch16 — live gate reasons and ignored synthesis", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records candidate_unauthorized and scope_hash_mismatch for adapter-authorized rerank items", async () => {
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("scope");
    const scopeHash = hashScopeIdentity(normalized);
    const rerankMod = await import("../modules/rerank");
    vi.spyOn(rerankMod, "rerankCandidates").mockResolvedValueOnce({
      items: [
        {
          id: "unauthorized-rerank",
          score: 99,
          text: "denied by policy",
          tier: "live",
          source: "live",
          authorizationResult: "denied",
          whyEntered: "test",
          scopeHash,
          rankPosition: 1,
        } as RetrievedItem,
        {
          id: "scope-mismatch-rerank",
          score: 98,
          text: "wrong scope hash",
          tier: "live",
          source: "live",
          authorizationResult: "allowed",
          whyEntered: "test",
          scopeHash: "sha256:wrong-scope",
          rankPosition: 2,
        } as RetrievedItem,
        {
          id: "missing-scope-rerank",
          score: 97,
          text: "missing scope hash",
          tier: "live",
          source: "live",
          authorizationResult: "allowed",
          whyEntered: "test",
          rankPosition: 3,
        } as RetrievedItem,
      ],
      receipt: { strategy: "provider", cutoff: 3, inputCount: 3, outputCount: 3 },
    });

    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 5,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "denied" && s.ids.includes("unauthorized-rerank"))).toBe(true);
    expect(stages.some((s) => s.stage === "denied" && s.ids.includes("scope-mismatch-rerank"))).toBe(true);
    expect(stages.some((s) => s.stage === "denied" && s.ids.includes("missing-scope-rerank"))).toBe(true);
    expect(stages.some((s) => s.stage === "ignored" && s.ids.length > 0)).toBe(true);
  });

  it("strongestFailure treats no-write audit skips as non-persisted required outcomes", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.anySkippedNoWrite).toBe(true);
    expect(run.auditPersistence?.allRequiredPersisted).toBe(false);
    expect(run.publicationGate?.caveats.some((c) => c.includes("audit_skipped_no_write"))).toBe(true);
  });
});
