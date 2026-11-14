// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildDefaultEvalConfig,
  formatEvalConfigYaml,
  parseEvalConfigYaml,
  weightsForAgent,
} from "../config";

describe("evals config batch35 — format optional arms and parse agent preset branches", () => {
  it("parses agent eval weights without golden_set and multiline preset non-weight keys (229-230, 236)", () => {
    const yaml = `
agents:
  weights-only-b35:
    eval:
      weights: { l1: 0.25, l2: 0.25, l3: 0.5 }
weight_presets:
  multiline-b35:
    l1: 0.12
    noise_key: ignored
    l3: 0.33
companies:
  acme_b35:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.agents["weights-only-b35"]?.eval?.weights?.l1).toBe(0.25);
    expect(config.agents["weights-only-b35"]?.eval?.goldenSet).toBeUndefined();
    expect(config.weightPresets["multiline-b35"]?.l2).toBe(0.5);
    expect(config.weightPresets["multiline-b35"]?.l3).toBe(0.33);
  });

  it("falls back to default public_api rate limits when section omitted (314, 318)", () => {
    const yaml = `
companies:
  solo_b35:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const defaults = buildDefaultEvalConfig();
    const config = parseEvalConfigYaml(yaml);
    expect(config.publicApi?.rateLimit.requestsPerMinute).toBe(defaults.publicApi?.rateLimit.requestsPerMinute);
    expect(config.publicApi?.rateLimit.burst).toBe(defaults.publicApi?.rateLimit.burst);
  });

  it("formatEvalConfigYaml renders empty agent eval blocks and finance defaults (428-442, 457-458)", () => {
    const config = buildDefaultEvalConfig();
    config.agents = {
      "shell-b35": { eval: {} },
    };
    config.weightPresets = {};
    config.companies = {};
    config.finance = undefined as never;
    config.cove = { ...config.cove, judgeEndpoint: "" };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("golden_set: ''");
    expect(yaml).toContain("weights: {}");
    expect(yaml).toContain("# no presets defined");
    expect(yaml).toContain("# per-company L3 weight overrides");
    expect(yaml).not.toContain("judge_endpoint:");
    expect(yaml).toContain("transaction_label: transaction");
  });

  it("weightsForAgent returns active preset without per-agent merge (504)", () => {
    const config = buildDefaultEvalConfig();
    config.activePreset = "outcome-weighted";
    config.agents = {
      "worker-b35": { eval: { weights: { l1: 0.9, l2: 0.05, l3: 0.05 } } },
    };
    const weights = weightsForAgent(config, "worker-b35");
    expect(weights).toEqual(config.weightPresets["outcome-weighted"]);
  });
});
