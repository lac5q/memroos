// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  aggregateByLane,
  hashConfig,
  isAnswerSupported,
  normalizeForAnswerCheck,
  resolveLane,
  round,
  scoreTask,
} from "../metrics";
import type { AdapterResult, NormalizedTask } from "../schema";

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    id: "task-b25b",
    dataset: "memroos_public_synthetic",
    task_type: "single_hop",
    corpus: [{ id: "mem-1", text: "expected fact batch25b" }],
    question: "q",
    expected_answer: "expected fact batch25b",
    evidence_spans: ["mem-1"],
    license: "MIT",
    citation: "batch25b",
    provenance: {
      dataset: "memroos_public_synthetic",
      sourceCitation: "batch25b",
      sourceLicense: "MIT",
      sourceAvailability: "synthetic",
    },
    ...overrides,
  };
}

function makeResult(overrides: Partial<AdapterResult> = {}): AdapterResult {
  return {
    taskId: "task-b25b",
    adapterName: "lexical",
    status: "ok",
    retrieved: [{ id: "mem-1", text: "expected fact batch25b", tier: "lexical", source: "test", score: 1, rankPosition: 1, authorizationResult: "allowed", whyEntered: "test", scopeHash: "s" }],
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

describe("retrieval-bench metrics batch25b — answer check and lane aggregation", () => {
  it("normalizeForAnswerCheck and isAnswerSupported reject empty expected answers", () => {
    expect(normalizeForAnswerCheck(null)).toBe("");
    expect(isAnswerSupported("", "some text")).toBe(false);
    expect(isAnswerSupported("  ", "some text")).toBe(false);
    expect(isAnswerSupported("Fact.", "prefix Fact suffix")).toBe(true);
  });

  it("round, hashConfig, resolveLane, and aggregateByLane produce stable lane buckets", () => {
    expect(round(1.234567, 2)).toBe(1.23);
    const cfgHash = hashConfig({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      k: 3,
      seed: 1,
      rerankEnabled: false,
      judgeEnabled: false,
      providerFlags: { embedding: false, vector_backend: false, rerank: false, judge: false, external_mcp: false },
    });
    expect(cfgHash).toMatch(/^sha256:/);
    const lane = resolveLane(makeTask());
    expect(lane).toBeTruthy();
    const scored = scoreTask({ task: makeTask(), result: makeResult(), k: 1, lane });
    const byLane = aggregateByLane([scored]);
    expect(byLane[lane]).not.toBeNull();
  });
});
