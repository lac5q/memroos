// @vitest-environment node
import { describe, expect, it } from "vitest";

import { aggregateTaskScores, scoreTask } from "../metrics";
import type { AdapterResult, NormalizedTask } from "../schema";

function makeTask(id: string): NormalizedTask {
  return {
    id,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "mem-1", text: "fact batch27" }],
    question: "q",
    expected_answer: "fact batch27",
    evidence_spans: ["mem-1"],
    license: "MIT",
    citation: "batch27",
    provenance: {
      dataset: "memroos_public_synthetic",
      sourceCitation: "batch27",
      sourceLicense: "MIT",
      sourceAvailability: "synthetic",
    },
  };
}

function makeResult(taskId: string, tokenValue: number | string | null): AdapterResult {
  return {
    taskId,
    adapterName: "lexical",
    status: "ok",
    retrieved: [{ id: "mem-1", text: "fact batch27", tier: "lexical", source: "test", score: 1, rankPosition: 1, authorizationResult: "allowed", whyEntered: "test", scopeHash: "s" }],
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
        tokensRetrieval: tokenValue,
        tokensRerank: 0,
        tokensPack: 0,
        tokensJudge: 0,
        contextPackBytes: null,
        contextPackHash: null,
      },
    },
  };
}

describe("retrieval-bench metrics batch27 — token accounting edges", () => {
  it("aggregateTaskScores treats string token metrics as unavailable", () => {
    const scored = scoreTask({
      task: makeTask("task-str"),
      result: makeResult("task-str", "not-a-number"),
      k: 1,
      lane: "external_retrieval",
    });
    const aggregate = aggregateTaskScores([scored]);
    expect(aggregate.tokensRetrieval).toBeNull();
    expect(aggregate.tokenAccounting.retrieval.status).toBe("unavailable");
  });

  it("aggregateTaskScores sums numeric token metrics when every task reports numbers", () => {
    const a = scoreTask({
      task: makeTask("task-a"),
      result: makeResult("task-a", 2),
      k: 1,
      lane: "external_retrieval",
    });
    const b = scoreTask({
      task: makeTask("task-b"),
      result: makeResult("task-b", 3),
      k: 1,
      lane: "external_retrieval",
    });
    const aggregate = aggregateTaskScores([a, b]);
    expect(aggregate.tokensRetrieval).toBe(5);
    expect(aggregate.tokenAccounting.retrieval.status).toBe("measured");
  });
});
