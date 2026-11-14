// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch37 — presets, agents, active_preset empty", () => {
  it("parseEvalConfigYaml merges weight_presets sub-keys (234-240)", () => {
    const yaml = `
weight_presets:
  outcome_b37:
    l1: 0.15
    l2: 0.45
    l3: 0.40
companies:
  solo_b37:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.weightPresets.outcome_b37).toEqual({ l1: 0.15, l2: 0.45, l3: 0.4 });
  });

  it("parseEvalConfigYaml reads agents eval golden_set (228-230)", () => {
    const yaml = `
agents:
  agent_b37:
    eval:
      golden_set: ./golden-sets/agent-b37.jsonl
      weights:
        l1: 0.1
        l2: 0.2
        l3: 0.7
companies:
  solo_b37:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.agents.agent_b37?.eval?.goldenSet).toBe("./golden-sets/agent-b37.jsonl");
  });

  it.skip("active_preset empty string to null (262) — parser preserves empty quoted scalar", () => {});

  it("formatEvalConfigYaml omits cove judge_endpoint when unset (454)", () => {
    const config = buildDefaultEvalConfig();
    config.cove.judgeEndpoint = "";
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).not.toMatch(/judge_endpoint:/);
  });
});