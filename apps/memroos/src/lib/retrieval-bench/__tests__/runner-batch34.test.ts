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

describe("retrieval-bench runner batch34 — gate branches and ignored union", () => {
  it("rejects direct callers without cliCommand or bypass (484–498)", async () => {
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
    } as Parameters<typeof runBenchmark>[0]);
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toBe("cli_parser_required");
  });

  it("returns adapter_not_registered for unknown adapter (545–549)", async () => {
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: `missing-b34-${randomUUID().slice(0, 6)}`,
      limit: 1,
      k: 2,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toMatch(/^adapter_not_registered:/);
  });

  it("withAudit:false skips run audit while benchmark completes (591–601)", async () => {
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 34,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      withAudit: false,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.allRequiredPersisted ?? true).toBe(true);
    expect(run.auditPersistence?.anySkippedNoWrite ?? false).toBe(false);
  });

  it("maps pack.omitted into ignored when absent from result.ignored (781)", async () => {
    const omittedId = `omitted-b34-${randomUUID().slice(0, 8)}`;
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            omitted: [{ id: omittedId, reason: "over_byte_budget" }, ...base.omitted],
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
      seed: 34,
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

  it("contamination gate records foreign artifact tags (887–900)", async () => {
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 34,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
      injectedArtifactTagsForTest: [{ runId: "foreign-b34", lane: "public", dataset: "x", adapter: "x", tenantId: "t", scope: "foreign:scope", seed: 0 }],
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.publicationGate?.caveats.some((c) => c.includes("contamination"))).toBe(true);
  });

  it.skip("strongestFailure missing_audit_outcome (!o at 451–453) — no live path", () => {});
});
