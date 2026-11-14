// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch24 — company validation and nested yaml branches", () => {
  it("throws when company l3_sub_weights do not sum to 1.0", () => {
    const yaml = `
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.5
      escalation_rate: 0.5
      ttr_p50: 0.5
      operator_approval_rate: 0.0
      cost_per_task: 0.0
`;
    expect(() => parseEvalConfigYaml(yaml)).toThrow(/must sum to 1.0/);
  });

  it("parses inline weight_presets and ignores invalid company sub-weight keys", () => {
    const yaml = `
weight_presets:
  inline-only: { l1: 0.1, l2: 0.2, l3: 0.7 }
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
      bogus_kpi: 9
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.weightPresets["inline-only"]).toEqual({ l1: 0.1, l2: 0.2, l3: 0.7 });
    expect(config.companies.acme?.l3_sub_weights.cost_per_task).toBe(0.1);
    expect(
      (config.companies.acme?.l3_sub_weights as Record<string, number>).bogus_kpi,
    ).toBeUndefined();
  });

  it("formatEvalConfigYaml renders companies and cove judge endpoint fallbacks", () => {
    const config = buildDefaultEvalConfig();
    config.companies = {
      acme: {
        l3_sub_weights: {
          completion_rate: 0.35,
          escalation_rate: 0.25,
          ttr_p50: 0.2,
          operator_approval_rate: 0.1,
          cost_per_task: 0.1,
        },
      },
    };
    config.cove = {
      enabled: true,
      maxVerificationQuestions: 3,
      parallelVerification: false,
      judgeEndpoint: "",
    };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("companies:");
    expect(yaml).toContain("acme:");
    expect(yaml).toContain("cove:");
  });
});
