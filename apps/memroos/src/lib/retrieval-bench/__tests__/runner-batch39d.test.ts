// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

afterEach(() => {
  vi.doUnmock("../modules/context-pack");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch39d", () => {
  it.skip("strongestFailure missing_audit_outcome (451-453) — no live path passes null outcomes", () => {});

  it("maps pack.omitted into ignored union when ids were not already tracked (781)", async () => {
    const omittedId = `omitted-b39d-${randomUUID().slice(0, 8)}`;
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            omitted: [{ id: omittedId, reason: "over_token_budget" }, ...base.omitted],
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
      seed: 39,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const taskId = run.report.tasks[0]?.taskId;
    const ignoredStage = run.pipeline?.perTaskStageRecords.get(taskId ?? "")?.find((s) => s.stage === "ignored");
    expect(ignoredStage?.ids).toContain(omittedId);
  });
});