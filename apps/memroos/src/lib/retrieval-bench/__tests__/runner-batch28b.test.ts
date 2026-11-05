// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

describe("retrieval-bench runner batch28b — unsupported dataset and lexical smoke", () => {
  it("runBenchmark fails closed for unsupported dataset ids", async () => {
    const run = await runBenchmark({
      dataset: "not_a_real_dataset" as "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 28,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toMatch(/dataset_not_assigned_to_lane|dataset_unsupported/);
  });

  it("runBenchmark lexical path returns tasks with redacted report bodies", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 2,
      k: 3,
      seed: 28,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.report.tasks.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(run.report);
    expect(serialized).not.toMatch(/"rawBody"\s*:\s*"/);
  });
});
