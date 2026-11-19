// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "@/lib/retrieval-bench/runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");
const OUT_ROOT = path.join(os.tmpdir(), `runner-b22-out-${process.pid}`);

afterEach(() => {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
});

describe("retrieval-bench runner batch22 — audit persistence and publication gate", () => {
  it("noWrite marks required audit persistence as incomplete", async () => {
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
    expect(run.auditPersistence?.allRequiredPersisted).toBe(false);
    expect(run.auditPersistence?.anySkippedNoWrite).toBe(true);
    expect(run.publicationGate?.caveats.some((c) => c.includes("audit_skipped_no_write"))).toBe(true);
  });
});
