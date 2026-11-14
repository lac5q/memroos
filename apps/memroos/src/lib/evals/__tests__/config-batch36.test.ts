// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildDefaultEvalConfig,
  parseEvalConfigYaml,
  weightsForAgent,
} from "../config";

describe("evals config batch36 — preset null, scorer fallback, partial weights", () => {
  it("parseEvalConfigYaml treats active_preset null as null (260-264)", () => {
    const yaml = `
active_preset: null
companies:
  solo_b36:
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

  it("parseEvalConfigYaml keeps default scorers when list empty (284-286)", () => {
    const yaml = `
scorers:
  l1_capability: []
  l2_quality: []
  l3_outcome: []
companies:
  solo_b36:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const defaults = buildDefaultEvalConfig();
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.scorers.l1Capability).toEqual(defaults.scorers.l1Capability);
    expect(parsed.scorers.l3Outcome).toEqual(defaults.scorers.l3Outcome);
  });

  it("weightsForAgent skips normalization when override sum is zero (511)", () => {
    const config = buildDefaultEvalConfig();
    config.activePreset = null;
    config.agents = {
      "zero-b36": { eval: { weights: { l1: 0, l2: 0, l3: 0 } } },
    };
    const weights = weightsForAgent(config, "zero-b36");
    expect(weights.l1).toBe(0);
    expect(weights.l2).toBe(0);
    expect(weights.l3).toBe(0);
  });

  it("parseEvalConfigYaml ignores unknown company l3 keys (250-253)", () => {
    const yaml = `
companies:
  solo_b36:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
      mystery_metric: 0.99
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.companies.solo_b36?.l3_sub_weights.cost_per_task).toBe(0.1);
    expect(
      Object.keys(parsed.companies.solo_b36?.l3_sub_weights ?? {}).some((k) => k === "mystery_metric"),
    ).toBe(false);
  });
});
