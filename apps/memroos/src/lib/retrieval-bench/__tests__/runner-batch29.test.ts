// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

afterEach(() => {
  vi.doUnmock("../modules/context-pack");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch29 — pack.omitted → ignored union (L781)", () => {
  it("adds pack.omitted ids to pipeline ignored stage when not already in result.ignored", async () => {
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            omitted: [
              { id: "omitted-b29-pack", reason: "over_byte_budget" },
              ...base.omitted,
            ],
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
      seed: 29,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const taskId = run.report.tasks[0]?.taskId;
    expect(taskId).toBeDefined();
    if (!taskId) return;
    const stages = run.pipeline?.perTaskStageRecords.get(taskId) ?? [];
    expect(stages.some((s) => s.stage === "ignored" && s.ids.includes("omitted-b29-pack"))).toBe(true);
  });
});
