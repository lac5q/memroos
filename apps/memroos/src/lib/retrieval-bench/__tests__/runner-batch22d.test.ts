// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "@/lib/retrieval-bench/runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");
const OUT_ROOT = path.join(os.tmpdir(), `runner-b22d-out-${process.pid}`);

afterEach(() => {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
});

describe("retrieval-bench runner batch22d — multi-task pipeline trace", () => {
  it("returns pipeline trace counts for multi-task lexical runs", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 3,
      k: 2,
      seed: 7,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
      rerankEnabled: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.report.taskCount).toBe(3);
    expect(run.pipeline?.entityExtractionCount).toBeGreaterThan(0);
  });
});
