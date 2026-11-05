// @vitest-environment node
import { describe, expect, it } from "vitest";

import { runBenchmark } from "@/lib/retrieval-bench/runner";

describe("retrieval-bench runner batch20c", () => {
  it("returns cli_command_required when bypassCliParser is false and cliCommand missing", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 0,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toMatch(/cli_command_required|cli/i);
  });

  it("returns dataset_unsupported for unknown dataset with bypassCliParser", async () => {
    const run = await runBenchmark({
      dataset: "not_a_real_dataset_xyz" as "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 0,
      bypassCliParser: true,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toMatch(/dataset_not_assigned_to_lane|dataset_unsupported/);
  });
});
