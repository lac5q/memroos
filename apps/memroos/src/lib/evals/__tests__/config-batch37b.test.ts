// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch37b — active_preset null and invalid preset weights", () => {
  it("parseEvalConfigYaml treats active_preset: null as null (262-264)", () => {
    const yaml = `
active_preset: null
companies:
  solo_b37b:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.activePreset).toBeNull();
  });

  it("parseEvalConfigYaml skips non-finite weight_presets l2 values (237-240)", () => {
    const yaml = `
weight_presets:
  broken_b37b:
    l1: 0.2
    l2: not-a-number
    l3: 0.3
companies:
  solo_b37b:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.weightPresets.broken_b37b?.l2).toBe(0.5);
  });

  it("formatEvalConfigYaml includes judge_endpoint when set (454)", () => {
    const config = buildDefaultEvalConfig();
    config.cove.judgeEndpoint = "http://localhost:11434/v1/chat";
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toMatch(/judge_endpoint: http:\/\/localhost:11434\/v1\/chat/);
  });
});