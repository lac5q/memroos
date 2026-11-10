// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, parseEvalConfigYaml, weightsForAgent } from "../config";

describe("evals config batch30 — parseWeights empty value and scalar/bool branches", () => {
  it("parseWeights early-return when agent eval weights line is blank (line 124)", () => {
    const yaml = `
agents:
  blank_weights_bot:
    eval:
      golden_set: "./golden-sets/batch30.jsonl"
      weights:
companies:
  acme_b30:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.agents.blank_weights_bot?.eval?.goldenSet).toBe("./golden-sets/batch30.jsonl");
    expect(config.agents.blank_weights_bot?.eval?.weights).toEqual({});
    expect(weightsForAgent(config, "blank_weights_bot").l1).toBeCloseTo(0.2, 5);
  });

  it("parseList returns empty for missing list values and keeps scorer defaults", () => {
    const yaml = `
companies:
  acme_b30b:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    const defaults = buildDefaultEvalConfig();
    expect(config.scorers.l1Capability).toEqual(defaults.scorers.l1Capability);
    expect(config.compliance.dataResidency.allowedLocalHosts).toContain("localhost");
  });

  it("bool and numberValue fallbacks apply for cove and drift_guard", () => {
    const yaml = `
drift_guard:
  judge_rotation_requires_rebaseline: maybe
cove:
  enabled: not-bool
  max_verification_questions: 999
  parallel_verification: ""
companies:
  acme_b30c:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.driftGuard.judgeRotationRequiresRebaseline).toBe(true);
    expect(config.cove.enabled).toBe(false);
    expect(config.cove.maxVerificationQuestions).toBe(12);
    expect(config.cove.parallelVerification).toBe(true);
  });
});
