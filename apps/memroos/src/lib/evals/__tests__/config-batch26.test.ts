// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch26 — parseWeights edges, agents block, format branches", () => {
  it("parseWeights returns empty object when weights value is absent", () => {
    const yaml = `
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.agents).toEqual({});
    expect(config.weights.l1).toBeGreaterThan(0);
  });

  it("parseEvalConfigYaml ignores invalid weight keys inside inline preset objects", () => {
    const yaml = `
weight_presets:
  noisy-inline: { l1: 0.1, l9: 0.9, l2: 0.2, l3: 0.7 }
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.weightPresets["noisy-inline"]).toEqual({ l1: 0.1, l2: 0.2, l3: 0.7 });
  });

  it("parses agent eval golden_set without weights block", () => {
    const yaml = `
agents:
  worker-b26:
    eval:
      golden_set: ./golden-sets/worker.jsonl
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.agents["worker-b26"]?.eval?.goldenSet).toBe("./golden-sets/worker.jsonl");
    expect(config.agents["worker-b26"]?.eval?.weights).toBeUndefined();
  });

  it("formatEvalConfigYaml renders empty agents and missing preset placeholders", () => {
    const config = buildDefaultEvalConfig();
    config.agents = {};
    config.weightPresets = {};
    config.activePreset = "ops";
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("# no presets defined");
    expect(yaml).toContain("agents:");
    expect(yaml).toContain("active_preset: ops");
  });

  it("formatEvalConfigYaml omits cove judge endpoint when unset", () => {
    const config = buildDefaultEvalConfig();
    config.cove = { ...config.cove, judgeEndpoint: "" };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).not.toContain("judge_endpoint:");
  });
});
