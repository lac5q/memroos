// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("../modules/context-pack");
  vi.resetModules();
});

describe("retrieval-bench runner batch27 — audit skip gate and omitted merge", () => {
  it("runBenchmark marks no-write runs as not fully persisted", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 27,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.anySkippedNoWrite).toBe(true);
    expect(run.auditPersistence?.allRequiredPersisted).toBe(false);
  });

  it("maps pack.omitted into ignored when ids are not already present", async () => {
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
              { id: "omitted-b27-a", reason: "over_byte_budget" },
              { id: "omitted-b27-b", reason: "policy_denied" },
            ],
          };
        },
      };
    });
    vi.resetModules();
    const { runBenchmark: runFresh } = await import("../runner");
    const run = await runFresh({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 4,
      seed: 27,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
      scope: {
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
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "ignored" && s.ids.includes("omitted-b27-a"))).toBe(true);
    expect(stages.some((s) => s.stage === "ignored" && s.ids.includes("omitted-b27-b"))).toBe(true);
  });
});
