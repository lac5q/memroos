// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isOpenInferenceTrace, mapOpenInferenceToAgentEvalTrace } from "../openinference-mapper";

describe("openinference mapper long-tail", () => {
  it("detects OpenInference payloads", () => {
    expect(isOpenInferenceTrace(null)).toBe(false);
    expect(isOpenInferenceTrace({ "openinference.span.kind": "AGENT" })).toBe(true);
  });

  it("maps tokens to cost and preserves extra attributes", () => {
    const trace = mapOpenInferenceToAgentEvalTrace({
      "openinference.span.kind": "LLM",
      "input.value": "in",
      "output.value": "out",
      "llm.model_name": "gpt-test",
      "session.id": "sess-1",
      "metadata.agent_id": "agent-9",
      "llm.token_count.total": 1000,
      "custom.tag": "keep-me",
    });
    expect(trace.traceId).toBe("sess-1");
    expect(trace.agentModel).toBe("gpt-test");
    expect(trace.outcome?.costUsd).toBeCloseTo(0.002);
    expect(trace.metadata?.openInferenceAttributes).toEqual({ "custom.tag": "keep-me" });
  });
});
