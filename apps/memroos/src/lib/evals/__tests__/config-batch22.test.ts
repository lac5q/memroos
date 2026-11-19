// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseEvalConfigYaml } from "../config";

describe("evals config batch22 — companies blocks and inline preset parsing", () => {
  it("parses companies.l3_sub_weights overrides from nested YAML", () => {
    const yaml = `
companies:
  acme:
    l3_sub_weights:
      completion_rate: 0.5
      escalation_rate: 0.1
      ttr_p50: 0.15
      operator_approval_rate: 0.15
      cost_per_task: 0.1
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.companies.acme?.l3_sub_weights.completion_rate).toBe(0.5);
    expect(config.companies.acme?.l3_sub_weights.cost_per_task).toBe(0.1);
  });

  it("parses inline weight_presets objects on one line", () => {
    const yaml = `
weight_presets:
  inline-batch22: { l1: 0.05, l2: 0.35, l3: 0.60 }
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.weightPresets["inline-batch22"]).toEqual({ l1: 0.05, l2: 0.35, l3: 0.6 });
  });

  it("parseList strips bracket wrappers from compliance host lists", () => {
    const yaml = `
compliance:
  allowed_local_hosts: [localhost, ollama.local]
  adapters_enabled: [hubspot, salesforce]
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.compliance.dataResidency.allowedLocalHosts).toEqual(["localhost", "ollama.local"]);
    expect(config.compliance.enabledAdapters).toEqual(["hubspot", "salesforce"]);
  });
});
