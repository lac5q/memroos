// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkBackedEvalService } from "../sdk-eval-service";
import type { EvalRunResult } from "@/lib/evals/types";

function baselineRun(): EvalRunResult {
  return {
    id: "run-b18b",
    traceId: "trace-b18b",
    agentId: "agent-expected",
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

describe("SdkBackedEvalService batch18b", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("surfaces public API POST failures with status text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "forbidden" }, { status: 403 })),
    );
    const service = new SdkBackedEvalService({
      baseUrl: "https://memroos.example",
      apiKey: "explicit-key",
    });
    let caught: unknown;
    try {
      await service.runForTrace("trace-x");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Public API error 403");
  });

  it("rescoreForProposal rejects agentId mismatch on baseline run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/runs/run-b18b")) {
          return Response.json({ run: baselineRun() });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      }),
    );
    const golden = await import("@/lib/evals/golden-sets");
    vi.spyOn(golden, "loadGoldenSet").mockReturnValue([]);
    vi.spyOn(golden, "goldenSetPathForTrace").mockReturnValue("/tmp/golden-b18b.jsonl");

    const service = new SdkBackedEvalService({
      baseUrl: "https://memroos.example",
      apiKey: "explicit-key",
    });
    let caught: unknown;
    try {
      await service.rescoreForProposal({
        traceId: "trace-b18b",
        agentId: "other-agent",
        baselineRunId: "run-b18b",
        proposalType: "salience_update",
        diff: { kind: "salience_update" },
        forecastWDelta: 0.01,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("belongs to agent-expected");
  });
});
