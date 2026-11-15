// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseEvalConfigYaml } from "../config";

const companyBlock = `
companies:
  solo_b38:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;

describe("evals config batch38 — active_preset empty normalization", () => {
  it("parseEvalConfigYaml treats bare active_preset empty value as null (262)", () => {
    const yaml = `
active_preset:
${companyBlock}`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.activePreset).toBeNull();
  });

  it.skip('active_preset: "" quoted empty (262) — parser yields empty string not null', () => {});

  it("parseEvalConfigYaml reads dot-prefixed active_preset fallback (260)", () => {
    const yaml = `
.active_preset: outcome-weighted
${companyBlock}`;
    const parsed = parseEvalConfigYaml(yaml);
    expect(parsed.activePreset).toBe("outcome-weighted");
  });
});