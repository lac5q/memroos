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

describe("retrieval-bench runner batch35", () => {
  it.skip("strongestFailure missing_audit_outcome (!o at 451–453) — no live path", () => {});

  it("records filtered_by_stage ignored entries (781–791)", async () => {
    const extraId = `fanout-b35-${randomUUID().slice(0, 8)}`;
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            items: [],
            omitted: [],
            receipt: { ...base.receipt, selectedCount: 0, bytes: 0, tokens: 0 },
          };
        },
      };
    });
    vi.resetModules();
    const { runBenchmark } = await import("../runner");
    let stageIgnored: string[] = [];
    const fanoutItem = {
      id: extraId,
      text: "synthetic fanout batch35 stage exclusion",
      tier: "lexical" as const,
      source: "test_fanout",
      score: 0.99,
      rankPosition: 50,
      authorizationResult: "allowed" as const,
      whyEntered: "batch35_fanout",
      scopeHash: `scope-${randomUUID().slice(0, 6)}`,
      timestamp_iso: "2026-11-12T00:00:00.000Z",
    };
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 3,
      seed: 35,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
      fanoutItemsForTest: [fanoutItem],
      onStageRecords: (records) => {
        for (const stages of records.values()) {
          const ignoredStage = stages.find((s) => s.stage === "ignored");
          if (ignoredStage?.ids) stageIgnored = ignoredStage.ids;
        }
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(stageIgnored).toContain(extraId);
  });

  it("maps pack.omitted into ignored union (779–782)", async () => {
    const omittedId = `omitted-b35-${randomUUID().slice(0, 8)}`;
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
      seed: 35,
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

  it("rejects dataset without bypassCliParser (484–498)", async () => {
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
});
