// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch28 — company weight validation, active preset, cove clamp", () => {
  it("throws when company l3_sub_weights do not sum to 1.0", () => {
    const yaml = `
companies:
  broken:
    l3_sub_weights:
      completion_rate: 0.40
      escalation_rate: 0.30
      ttr_p50: 0.10
      operator_approval_rate: 0.05
      cost_per_task: 0.05
`;
    expect(() => parseEvalConfigYaml(yaml)).toThrow(/must sum to 1\.0/);
  });

  it("ignores invalid KPI keys under company l3_sub_weights", () => {
    const yaml = `
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
      bogus_kpi: 0.99
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.companies.acme.l3_sub_weights).not.toHaveProperty("bogus_kpi");
  });

  it("parses active_preset null and clamps cove max verification questions", () => {
    const yaml = `
active_preset: null
cove:
  enabled: true
  max_verification_questions: 99
  parallel_verification: false
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.activePreset).toBeNull();
    expect(config.cove.maxVerificationQuestions).toBe(12);
    expect(config.cove.parallelVerification).toBe(false);
  });

  it("formatEvalConfigYaml round-trips judge model provider from defaults", () => {
    const defaults = buildDefaultEvalConfig();
    const text = formatEvalConfigYaml(defaults);
    expect(text).toContain(`provider: ${defaults.judgeModel.provider}`);
    const reparsed = parseEvalConfigYaml(text);
    expect(reparsed.judgeModel.model).toBe(defaults.judgeModel.model);
  });
});
