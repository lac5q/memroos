// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseEvalConfigYaml } from "../config";

describe("evals config batch29 — agents.eval branches and company KPI guards", () => {
  it("parses agents.<id>.eval.golden_set and agents.<id>.eval.weights", () => {
    const yaml = `
agents:
  ops_bot:
    eval:
      golden_set: "./golden-sets/custom-batch29.jsonl"
      weights: { l1: 0.15, l2: 0.45, l3: 0.40 }
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.agents.ops_bot?.eval?.goldenSet).toBe("./golden-sets/custom-batch29.jsonl");
    expect(config.agents.ops_bot?.eval?.weights).toEqual({ l1: 0.15, l2: 0.45, l3: 0.4 });
  });

  it("ignores non-finite weight preset components and invalid company KPI values", () => {
    const yaml = `
weight_presets:
  broken_batch29:
    l1: 0.11
    l2: not-a-number
    l3: 0.33

companies:
  acme_batch29:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
      nan_kpi: nan
      bogus_kpi: 0.99
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.weightPresets.broken_batch29?.l2).toBe(0.5);
    expect(config.companies.acme_batch29.l3_sub_weights).not.toHaveProperty("nan_kpi");
    expect(config.companies.acme_batch29.l3_sub_weights).not.toHaveProperty("bogus_kpi");
  });
});
