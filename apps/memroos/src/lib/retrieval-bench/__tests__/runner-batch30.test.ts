// @vitest-environment node
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");

afterEach(() => {
  vi.doUnmock("../modules/context-pack");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("retrieval-bench runner batch30 — ignored union and no-write audit", () => {
  it("maps pack.omitted entries into ignored when absent from result.ignored (781)", async () => {
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            omitted: [{ id: `omitted-batch30-${crypto.randomUUID().slice(0, 8)}`, reason: "over_byte_budget" }, ...base.omitted],
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
      seed: 30,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const taskId = run.report.tasks[0]?.taskId;
    expect(taskId).toBeDefined();
    if (!taskId) return;
    const ignoredStage = run.pipeline?.perTaskStageRecords.get(taskId)?.find((s) => s.stage === "ignored");
    expect(ignoredStage?.ids.some((id) => id.startsWith("omitted-batch30-"))).toBe(true);
  });

  it("no-write runs keep required audit persistence incomplete (451–453 via strongestFailure)", async () => {
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 3030,
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
