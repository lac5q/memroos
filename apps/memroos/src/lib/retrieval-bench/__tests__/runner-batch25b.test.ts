// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { loadDataset, runBenchmark } from "../runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

describe("retrieval-bench runner batch25b — parser gate and audit-off path", () => {
  it("runBenchmark fails closed when CLI parser was not invoked", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      fixturesDir: FIXTURES_DIR,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toBe("cli_parser_required");
  });

  it("loadDataset returns explicit errors for unsupported dataset ids", () => {
    const unsupported = loadDataset({
      dataset: "not-a-real-dataset" as "memroos_public_synthetic",
      fixturesDir: FIXTURES_DIR,
    });
    expect(unsupported.ok).toBe(false);
    expect(String(unsupported.reason)).toMatch(/dataset_unsupported/);
  });

  it("withAudit false still completes lexical benchmark without audit persistence", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 3,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
      withAudit: false,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.run).toBeNull();
    expect(run.report.tasks.length).toBeGreaterThan(0);
  });
});
