// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark } from "../runner";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");
const OUT_ROOT = path.join(os.tmpdir(), `runner-b19b-out-${process.pid}`);

afterEach(() => {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
});

describe("retrieval-bench runner batch19b — audit persistence aggregation", () => {
  it("noWrite marks allRequiredPersisted false with audit_skipped_no_write reasons", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 3,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.anySkippedNoWrite).toBe(true);
    expect(run.auditPersistence?.allRequiredPersisted).toBe(false);
    expect(run.publicationGate?.caveats.some((c) => /audit|persist|skip/i.test(c))).toBe(true);
  });

  it("live adapter surfaces omitted stage ids alongside ignored receipts", async () => {
    const { runBenchmark: runFresh } = await import("../runner");
    const run = await runFresh({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
      scope: {
        tenantId: "benchmark-tenant",
        userId: "benchmark-user",
        agentId: "benchmark-agent",
        spaceId: "benchmark-space",
        label: {
          visibility: "internal" as const,
          policy: "agent_visible" as const,
          domain: "benchmark",
          sensitivity: null,
        },
        purpose: "memory_search" as const,
        beliefStage: "silver_candidate_claim" as const,
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "omitted" || s.stage === "packed")).toBe(true);
  });
});
