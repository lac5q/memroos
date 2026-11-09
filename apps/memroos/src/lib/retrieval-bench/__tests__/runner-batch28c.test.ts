// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

describe("retrieval-bench runner batch28c — audit persistence markers", () => {
  it("no-write runs mark required audit persistence as incomplete (lines 451-453 via auditPersistence)", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 28,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.allRequiredPersisted).toBe(false);
    expect(run.auditPersistence?.anySkippedNoWrite).toBe(true);
  });

  it("lexical adapter run records publication gate caveats when writes are skipped", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 2,
      k: 3,
      seed: 99,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.publicationGate?.caveats.some((c) => c.includes("audit_skipped_no_write"))).toBe(true);
  });
});
