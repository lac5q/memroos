// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");
const OUT_ROOT = path.join(os.tmpdir(), `runner-b19-out-${process.pid}`);

const LIVE_SCOPE = {
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
};

afterEach(() => {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  vi.doUnmock("../modules/context-pack");
  vi.resetModules();
});

describe("retrieval-bench runner batch19", () => {
  it("maps pack.omitted entries into ignored receipts on the live pipeline", async () => {
    vi.doMock("../modules/context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../modules/context-pack")>();
      return {
        ...actual,
        packContext: (input: Parameters<typeof actual.packContext>[0]) => {
          const base = actual.packContext(input);
          return {
            ...base,
            items: base.items.slice(0, 1),
            omitted: [{ id: "packed-out-b19", reason: "over_byte_budget" }],
          };
        },
      };
    });
    vi.resetModules();
    const { runBenchmark } = await import("../runner");
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "live",
      limit: 1,
      k: 3,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      scope: LIVE_SCOPE,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const task = run.report.tasks[0]!;
    const stages = run.pipeline?.perTaskStageRecords.get(task.taskId) ?? [];
    expect(stages.some((s) => s.stage === "omitted" && s.ids.includes("packed-out-b19"))).toBe(true);
  });
});
