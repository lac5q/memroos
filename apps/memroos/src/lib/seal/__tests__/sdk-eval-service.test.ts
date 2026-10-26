// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkBackedEvalService } from "../sdk-eval-service";
import type { EvalRunResult } from "@/lib/evals/types";

function baselineRun(): EvalRunResult {
  return {
    id: "run-low",
    traceId: "trace-low",
    agentId: "agent-1",
    role: "ops",
    compositeW: 0.42,
    trusted: true,
    layers: {
      l1: { score: 0.4, weight: 0.25, scorers: [] },
      l2: { score: 0.42, weight: 0.5, scorers: [] },
      l3: { score: 0.45, weight: 0.25, scorers: [] },
    },
    scorerResults: [],
    judge: {
      score: 0.42,
      rubricScores: { faithful: 0.4, useful: 0.42, policy: 0.45 },
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

describe("SdkBackedEvalService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires an explicit internal API key in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousInternalKey = process.env.MEMROOS_INTERNAL_API_KEY;
    process.env.NODE_ENV = "production";
    delete process.env.MEMROOS_INTERNAL_API_KEY;

    expect(() => new SdkBackedEvalService()).toThrow(/MEMROOS_INTERNAL_API_KEY/);

    process.env.NODE_ENV = previousNodeEnv;
    if (previousInternalKey === undefined) {
      delete process.env.MEMROOS_INTERNAL_API_KEY;
    } else {
      process.env.MEMROOS_INTERNAL_API_KEY = previousInternalKey;
    }
  });

  it("persists modeled proposal re-scores through the public trace API", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/api/public/v1/runs/run-low")) {
        return Response.json({ run: baselineRun() });
      }
      if (href.endsWith("/api/public/v1/traces") && init?.method === "POST") {
        return Response.json({ runId: "eval-run-persisted", w: 0.43, layers: {} });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SdkBackedEvalService({
      baseUrl: "https://memroos.example",
      apiKey: "explicit-key",
    });
    const result = await service.rescoreForProposal({
      traceId: "trace-low",
      agentId: "agent-1",
      baselineRunId: "run-low",
      proposalType: "salience_update",
      diff: { kind: "salience_update", marker: "sdk-persist" },
      forecastWDelta: 0.08,
    });

    expect(result.id).toBe("eval-run-persisted");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://memroos.example/api/public/v1/traces",
      expect.objectContaining({ method: "POST" })
    );
    const traceBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
      metadata?: Record<string, unknown>;
    };
    expect(traceBody.metadata?.sealModeledRescore).toBe(true);
  });

  it("getRunById returns null on the SDK path", () => {
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-key",
    });
    expect(service.getRunById()).toBeNull();
  });

  it("createEvalServiceForSeal returns null outside production", async () => {
    const { createEvalServiceForSeal } = await import("../sdk-eval-service");
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      expect(createEvalServiceForSeal({ apiKey: "explicit-key" })).toBeNull();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("createEvalServiceForSeal constructs a service in production when keyed", async () => {
    const { createEvalServiceForSeal } = await import("../sdk-eval-service");
    const prevNode = process.env.NODE_ENV;
    const prevKey = process.env.MEMROOS_INTERNAL_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.MEMROOS_INTERNAL_API_KEY = "production-only-test-key-not-default";
    try {
      const service = createEvalServiceForSeal();
      expect(service).toBeInstanceOf(SdkBackedEvalService);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevKey === undefined) delete process.env.MEMROOS_INTERNAL_API_KEY;
      else process.env.MEMROOS_INTERNAL_API_KEY = prevKey;
    }
  });

  it("runForTrace submits a trace and loads the resulting run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith("/api/public/v1/traces") && init?.method === "POST") {
          return Response.json({ runId: "run-from-trace" });
        }
        if (href.endsWith("/api/public/v1/runs/run-from-trace")) {
          return Response.json({ run: { ...baselineRun(), id: "run-from-trace", traceId: "trace-abc" } });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      })
    );

    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-key",
    });
    const run = await service.runForTrace("trace-abc", "agent-1");
    expect(run.id).toBe("run-from-trace");
    expect(run.traceId).toBe("trace-abc");
  });

});
