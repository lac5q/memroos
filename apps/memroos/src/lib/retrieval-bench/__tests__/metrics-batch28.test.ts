// @vitest-environment node
import { describe, expect, it } from "vitest";

import { aggregateTaskScores, isAnswerSupported, round, scoreTask } from "../metrics";
import type { AdapterResult, NormalizedTask } from "../schema";

function makeTask(id: string, expected = "fact batch28"): NormalizedTask {
  return {
    id,
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "mem-1", text: "fact batch28" }],
    question: "q",
    expected_answer: expected,
    evidence_spans: ["mem-1"],
    license: "MIT",
    citation: "batch28",
    provenance: {
      dataset: "memroos_public_synthetic",
      sourceCitation: "batch28",
      sourceLicense: "MIT",
      sourceAvailability: "synthetic",
    },
  };
}

function makeResult(taskId: string, text: string): AdapterResult {
  return {
    taskId,
    adapterName: "lexical",
    status: "ok",
    retrieved: [{ id: "mem-1", text, tier: "lexical", source: "test", score: 1, rankPosition: 1, authorizationResult: "allowed", whyEntered: "test", scopeHash: "s" }],
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
        tokensRetrieval: 0,
        tokensRerank: 0,
        tokensPack: 0,
        tokensJudge: 0,
        contextPackBytes: null,
        contextPackHash: null,
      },
    },
  };
}

describe("retrieval-bench metrics batch28 — answer support and rounding", () => {
  it("isAnswerSupported rejects empty expected answers and blank retrieval text", () => {
    expect(isAnswerSupported("", "fact batch28")).toBe(false);
    expect(isAnswerSupported("fact batch28", "   ")).toBe(false);
    expect(isAnswerSupported("fact batch28", "prefix fact batch28 suffix")).toBe(true);
  });

  it("round leaves non-finite values untouched and aggregate handles zero tasks", () => {
    expect(round(Number.NaN)).toBeNaN();
    const aggregate = aggregateTaskScores([]);
    expect(aggregate.taskCount).toBe(0);
    const scored = scoreTask({
      task: makeTask("empty-expected", ""),
      result: makeResult("empty-expected", "anything"),
      k: 1,
      lane: "external_retrieval",
    });
    expect(scored.answerSupportedByRetrievedSource).toBe(false);
  });
});
