// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseEvalConfigYaml } from "../config";

describe("evals config batch27 — parseWeights filters, invalid KPI keys, active preset", () => {
  it("parseWeights ignores non-l1/l2/l3 keys in inline weight objects", () => {
    const yaml = `
weight_presets:
  noisy: { l9: 0.9, l1: 0.2, l3: 0.8 }
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
    expect(config.weightPresets.noisy).toEqual({ l1: 0.2, l2: 0.5, l3: 0.8 });
  });

});
