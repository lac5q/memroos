// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch26 — lane gate and omitted ignored merge", () => {
  it("runBenchmark fails closed when lane membership cannot be resolved", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "not-a-real-adapter" as "lexical",
      limit: 1,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(String(run.reason)).toMatch(/adapter_not_registered/);
  });

  it("runBenchmark rejects invalid lane assignment configuration", async () => {
    vi.doMock("../lanes", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../lanes")>();
      return {
        ...actual,
        verifyLaneAssignments: () => ({ ok: false, mismatches: ["lane_assignment_batch26"] }),
      };
    });
    vi.resetModules();
    const { runBenchmark: runWithBadLanes } = await import("../runner");
    const run = await runWithBadLanes({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 1,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    vi.doUnmock("../lanes");
    vi.resetModules();
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toBe("lane_assignment_invalid");
  });

  it("maps pack.omitted entries into ignored receipts when live pipeline drops items", async () => {
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            items: base.items.slice(0, 1),
            omitted: [{ id: "omitted-b26-only", reason: "over_byte_budget" }],
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
      seed: 26,
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
    vi.doUnmock("../modules/context-pack");
    vi.resetModules();
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "ignored" && s.ids.includes("omitted-b26-only"))).toBe(true);
  });
});
