// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkBackedEvalService } from "../sdk-eval-service";
import type { EvalRunResult } from "@/lib/evals/types";

function baselineRun(): EvalRunResult {
  return {
    id: "run-b27",
    traceId: "trace-b27",
    agentId: "agent-b27",
    role: "ops",
    compositeW: 0.5,
    trusted: true,
    layers: {
      l1: { score: 0.5, weight: 0.25, scorers: [] },
      l2: { score: 0.5, weight: 0.5, scorers: [] },
      l3: { score: 0.5, weight: 0.25, scorers: [] },
    },
    scorerResults: [],
    judge: {
      score: 0.5,
      rubricScores: { faithful: 0.5, useful: 0.5, policy: 0.5 },
      model: "judge",
      provider: "local",
      modelFamily: "local",
      promptTemplateVersion: "v1",
      promptHash: "hash",
      positionBiasMitigation: { swapAugmentation: true, orderAgreement: true },
    },
    driftGuard: {
      status: "passed",
      agreement: 1,
      floor: 0.85,
      goldenSetVersion: "golden",
      examples: [],
    },
    configHash: "config",
    goldenSetPath: "./golden-sets/ops-50.jsonl",
    startedAt: "2026-05-15T00:00:00.000Z",
    completedAt: "2026-05-15T00:00:01.000Z",
  };
}

describe("SdkBackedEvalService batch27 — HTTP error surfaces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rescoreForProposal returns baseline id when modeled lift is not persisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/runs/run-b27")) {
          return Response.json({ run: baselineRun() });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      }),
    );
    const golden = await import("@/lib/evals/golden-sets");
    vi.spyOn(golden, "loadGoldenSet").mockReturnValue({ version: "v1", examples: [] });
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-key",
    });
    const result = await service.rescoreForProposal({
      traceId: "trace-b27",
      agentId: "agent-b27",
      baselineRunId: "run-b27",
      proposalType: "noop_test",
      diff: {},
      forecastWDelta: 0.01,
    });
    expect(result.id).toBe("run-b27");
  });
});
