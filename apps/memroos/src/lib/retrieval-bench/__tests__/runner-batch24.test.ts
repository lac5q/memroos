// @vitest-environment node
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
};

afterEach(() => {
  vi.doUnmock("../modules/context-pack");
  vi.doUnmock("../modules/rerank");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch24 — ignored receipts and audit gaps", () => {
  it("maps pack.omitted into ignored when not already present in result.ignored", async () => {
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            items: base.items.slice(0, 1),
            omitted: [
              { id: "packed-out-b24", reason: "over_byte_budget" },
              { id: "packed-out-b24-dup", reason: "over_byte_budget" },
            ],
          };
        },
      };
    });
    vi.resetModules();
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 4,
      seed: 21,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "ignored" && s.ids.includes("packed-out-b24"))).toBe(true);
  });

  it("synthesizes ignored entries for retrieved items excluded from final pack", async () => {
    const normalized = normalizeScopeIdentity(LIVE_SCOPE);
    if (!normalized) throw new Error("scope");
    const scopeHash = hashScopeIdentity(normalized);
    vi.doMock("../modules/rerank", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/rerank")>();
      return {
        ...actual,
        rerankCandidates: vi.fn(async () => ({
          items: [
            {
              id: "kept-b24",
              score: 99,
              text: "kept",
              tier: "live",
              source: "live",
              authorizationResult: "allowed",
              whyEntered: "test",
              scopeHash,
              rankPosition: 1,
            },
            {
              id: "dropped-by-pack-b24",
              score: 98,
              text: "dropped",
              tier: "live",
              source: "live",
              authorizationResult: "allowed",
              whyEntered: "test",
              scopeHash,
              rankPosition: 2,
            },
          ],
          receipt: { strategy: "provider", cutoff: 2, inputCount: 2, outputCount: 2 },
        })),
      };
    });
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            items: base.items.filter((item) => item.id === "kept-b24"),
            omitted: base.omitted,
          };
        },
      };
    });
    vi.resetModules();
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 4,
      seed: 22,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "ignored" && s.ids.includes("dropped-by-pack-b24"))).toBe(true);
  });

  it("noWrite marks audit persistence as skipped and blocks allRequiredPersisted", async () => {
    const { runBenchmark } = await import("../runner");
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
