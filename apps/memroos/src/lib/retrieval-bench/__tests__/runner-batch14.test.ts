// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runBenchmark, renderTextReport } from "../runner";
import type { AggregateReport } from "../schema";

describe("retrieval-bench runner batch14", () => {
  it("runBenchmark requires cli parser unless bypassCliParser is set", async () => {
    const result = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cli_parser_required");
  });

  it("renderTextReport includes optional abstention and lane metric sections", () => {
    const report = {
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      taskCount: 2,
      fixtureHash: "sha256:fixture",
      configHash: "sha256:config",
      aggregate: {
        taskCount: 2,
        completedTaskCount: 2,
        failedTaskCount: 0,
        precisionAtK: 0.5,
        recallAtK: 0.5,
        mrr: 0.5,
        falsePositiveRate: 0,
        answerSupportedRate: 1,
        p95LatencyMs: 12,
        abstentionAccuracy: 0.75,
        abstentionLabeledCount: 4,
        abstentionAnswerableFailureCount: 1,
        contextPackBytes: 256,
        contextPackHash: "sha256:pack",
        tokensRetrieval: 10,
        tokensRerank: 5,
        tokensPack: 3,
        tokensJudge: 2,
        laneMetrics: {
          gold: {
            taskCount: 1,
            completedTaskCount: 1,
            failedTaskCount: 0,
            precisionAtK: 1,
            recallAtK: 1,
            mrr: 1,
            falsePositiveRate: 0,
            answerSupportedRate: 1,
            p95LatencyMs: 8,
            abstentionAccuracy: null,
            abstentionLabeledCount: null,
            abstentionAnswerableFailureCount: null,
            contextPackBytes: null,
            contextPackHash: null,
            tokensRetrieval: null,
            tokensRerank: null,
            tokensPack: null,
            tokensJudge: null,
            laneMetrics: {},
          },
        },
      },
      tasks: [],
    } as unknown as AggregateReport;
    const text = renderTextReport(report);
    expect(text).toContain("abstention_accuracy");
    expect(text).toContain("context_pack_hash");
    expect(text).toContain("tokens_judge");
    expect(text).toContain("### gold");
  });
});
