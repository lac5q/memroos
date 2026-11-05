// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  aggregateTaskScores,
  isLatencyAttributionReconciled,
  scoreTask,
  unavailable,
} from "../metrics";
import type { AdapterResult, NormalizedTask } from "../schema";

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    id: "task-b22d",
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "mem-1", text: "fact" }],
    question: "q",
    expected_answer: "fact",
    evidence_spans: ["mem-1"],
    license: "MIT",
    citation: "batch22d",
    provenance: {
      dataset: "memroos_public_synthetic",
      sourceCitation: "batch22d",
      sourceLicense: "MIT",
      sourceAvailability: "synthetic",
    },
    ...overrides,
  };
}

function makeResult(overrides: Partial<AdapterResult> = {}): AdapterResult {
  return {
    taskId: "task-b22d",
    adapterName: "lexical",
    status: "ok",
    retrieved: [],
    injected: ["mem-1"],
    ignored: [],
    latencyMs: 1,
    receipt: {
      adapterName: "lexical",
      adapterVersion: "v1",
      status: "ok",
      latencyMs: 1,
      authorization: { evaluated: false, allowed: true },
      provenance: {
        provider: null,
        providerVersion: null,
        retrievalPolicyVersion: "v1",
        configHash: "n/a",
        fixtureHash: "n/a",
      },
      metrics: {
        tokensRetrieval: 1,
        tokensRerank: null,
        tokensPack: null,
        tokensJudge: null,
        contextPackBytes: null,
        contextPackHash: null,
      },
    },
    ...overrides,
  };
}

describe("retrieval-bench metrics batch22d — aggregate edges", () => {
  it("aggregateTaskScores marks token sums unavailable when a task omits retrieval tokens", () => {
    const withTokens = scoreTask({
      task: makeTask({ id: "task-a" }),
      result: makeResult({ taskId: "task-a" }),
      k: 1,
      lane: "external_retrieval",
    });
    const missing = makeResult({ taskId: "task-b" });
    missing.receipt.metrics.tokensRetrieval = null;
    const withoutTokens = scoreTask({
      task: makeTask({ id: "task-b" }),
      result: missing,
      k: 1,
      lane: "external_retrieval",
    });
    const metrics = aggregateTaskScores([withTokens, withoutTokens]);
    expect(metrics.tokenAccounting.retrieval.status).toBe("unavailable");
  });

  it("isLatencyAttributionReconciled rejects non-finite end-to-end latency", () => {
    expect(
      isLatencyAttributionReconciled({
        endToEndMs: Number.NaN,
        componentTimes: { retrieval: unavailable("missing") },
      }),
    ).toBe(false);
  });
});
