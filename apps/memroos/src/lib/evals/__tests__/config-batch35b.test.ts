// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildDefaultEvalConfig,
  formatEvalConfigYaml,
  parseEvalConfigYaml,
  weightsForAgent,
} from "../config";

describe("evals config batch35b — preset merge, validation, format arms", () => {
  it("weightsForAgent normalizes partial per-agent overrides when preset inactive (504-517)", () => {
    const config = buildDefaultEvalConfig();
    config.activePreset = null;
    config.agents = {
      "partial-b35b": { eval: { weights: { l1: 0.2, l2: 0.2, l3: 0.2 } } },
    };
    const weights = weightsForAgent(config, "partial-b35b");
    const sum = weights.l1 + weights.l2 + weights.l3;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    expect(weights.l1).toBeCloseTo(1 / 3, 5);
  });

  it("parseEvalConfigYaml rejects company weights not summing to 1 (373-375)", () => {
    const yaml = `
companies:
  bad_b35b:
    l3_sub_weights:
      completion_rate: 0.9
      escalation_rate: 0.9
      ttr_p50: 0.9
      operator_approval_rate: 0.9
      cost_per_task: 0.9
`;
    expect(() => parseEvalConfigYaml(yaml)).toThrow(/must sum to 1\.0/i);
  });

  it("parseEvalConfigYaml clamps cove max_verification_questions (360-365)", () => {
    const yaml = `
companies:
  solo_b35b:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
cove:
  enabled: true
  max_verification_questions: 99
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.cove.maxVerificationQuestions).toBe(12);
  });

  it("parseEvalConfigYaml strips quoted active_preset values (260-264)", () => {
    const yaml = `
active_preset: "outcome-weighted"
companies:
  solo_b35b:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.activePreset).toBe("outcome-weighted");
  });

  it("formatEvalConfigYaml includes judge_endpoint when set (390, 454)", () => {
    const config = buildDefaultEvalConfig();
    config.judgeModel.localEndpoint = "http://localhost:11434/v1";
    config.cove.judgeEndpoint = "http://localhost:8088/judge";
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("local_endpoint: http://localhost:11434/v1");
    expect(yaml).toContain("judge_endpoint: http://localhost:8088/judge");
  });
});
