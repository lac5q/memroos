// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, parseEvalConfigYaml } from "@/lib/evals/config";
import { createEvalScorerRegistry } from "@/lib/evals/engine";
import type { AgentEvalTrace } from "@/lib/evals/types";
import {
  cove,
  coveHallucinationDeltaScorer,
  createOpenAICompatibleCoveClient,
  runCovePipeline,
} from "../index";

describe("CoVe pipeline", () => {
  it("runs draft, verification questions, checks, and revision through injected clients", async () => {
    const calls: string[] = [];
    const client = async (prompt: string) => {
      calls.push(prompt);
      if (prompt.includes("verification questions")) return "What is the capital?\nWhat country is it in?";
      if (prompt.includes("independent fact-check")) return "Paris is the capital of France.";
      if (prompt.includes("revise")) return "Paris is the capital of France.";
      return "Paris is the capital of Germany.";
    };

    const result = await runCovePipeline({
      input: "What is the capital of France?",
      draft: "Paris is the capital of Germany.",
      config: { enabled: true, maxVerificationQuestions: 2, parallelVerification: false },
      client,
    });

    expect(result.revisedAnswer).toBe("Paris is the capital of France.");
    expect(result.trace.questions).toEqual(["What is the capital?", "What country is it in?"]);
    expect(result.trace.factChecks).toHaveLength(2);
    expect(calls.length).toBe(4);
  });

  it("wraps any agent function and returns the revised answer plus verification trace", async () => {
    const agentFn = async () => "The revenue number was 10M, but cite no source.";
    const result = await cove(agentFn, {
      enabled: true,
      maxVerificationQuestions: 1,
      parallelVerification: true,
      client: async (prompt) => {
        if (prompt.includes("verification questions")) return "Is the revenue number sourced?";
        if (prompt.includes("Revise")) return "The sourced revenue number was 9M.";
        if (prompt.includes("independent fact-check")) return "The source says revenue was 9M.";
        return "The sourced revenue number was 9M.";
      },
    })("Report revenue.");

    expect(result.answer).toBe("The sourced revenue number was 9M.");
    expect(result.trace.draft).toContain("10M");
    expect(result.trace.factChecks[0].answer).toContain("9M");
  });

  it("returns draft unchanged when CoVe is disabled", async () => {
    const result = await runCovePipeline({
      input: "question",
      draft: "draft answer",
      config: { enabled: false, maxVerificationQuestions: 2, parallelVerification: false },
    });
    expect(result.revisedAnswer).toBe("draft answer");
    expect(result.trace.questions).toEqual([]);
  });

  it("adapts OpenAI-compatible local endpoints without model-specific branches", async () => {
    const requests: unknown[] = [];
    const client = createOpenAICompatibleCoveClient({
      endpoint: "http://localhost:11434/v1",
      model: "hermes3",
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      },
    });

    await expect(client("hello")).resolves.toBe("ok");
    expect(requests).toEqual([
      expect.objectContaining({
        model: "hermes3",
        messages: [{ role: "user", content: "hello" }],
      }),
    ]);
  });

  it("throws when the OpenAI-compatible endpoint returns a non-OK status", async () => {
    const client = createOpenAICompatibleCoveClient({
      endpoint: "http://localhost:11434/v1",
      model: "hermes3",
      fetchImpl: async () => {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        } as unknown as Response;
      },
    });
    let message = "no throw";
    try {
      await client("hello");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("503");
  });
});

describe("CoVe eval scorer", () => {
  it("registers as an eval scorer", () => {
    const registry = createEvalScorerRegistry();
    expect(registry.has("cove_hallucination_delta")).toBe(true);
  });

  it("scores hallucination reduction against baseline trace metadata", () => {
    const baselineTrace: AgentEvalTrace = {
      traceId: "baseline",
      agentId: "agent",
      input: "Name a source-backed amount.",
      output: "Revenue was 10M.",
      expectedFacts: ["Revenue was 9M"],
      metadata: { unsupportedClaims: ["10M"] },
    };
    const coveTrace: AgentEvalTrace = {
      ...baselineTrace,
      traceId: "cove",
      output: "Revenue was 9M.",
      metadata: {
        cove: {
          baselineTrace,
          unsupportedClaims: [],
          corrections: ["10M -> 9M"],
        },
      },
    };

    const result = coveHallucinationDeltaScorer.score(coveTrace, {
      config: buildDefaultEvalConfig(),
      judge: {
        score: 0.9,
        rubricScores: { faithful: 0.9, useful: 0.9, policy: 1 },
        model: "judge",
        provider: "local",
        modelFamily: "local",
        promptTemplateVersion: "v1",
        promptHash: "hash",
        positionBiasMitigation: { swapAugmentation: true, orderAgreement: true },
      },
      goldenSet: [],
    });

    expect(result.score).toBe(1);
    expect(result.metadata).toMatchObject({
      baselineUnsupportedClaims: 1,
      coveUnsupportedClaims: 0,
      corrections: 1,
    });
  });

  it("parses CoVe config from eval yaml", () => {
    const config = parseEvalConfigYaml(`
judge_model:
  provider: local
cove:
  enabled: true
  max_verification_questions: 5
  parallel_verification: true
  judge_endpoint: http://localhost:11434/v1
`);

    expect(config.cove).toEqual({
      enabled: true,
      maxVerificationQuestions: 5,
      parallelVerification: true,
      judgeEndpoint: "http://localhost:11434/v1",
    });
  });
});
