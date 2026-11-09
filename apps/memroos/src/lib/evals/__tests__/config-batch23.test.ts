// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch23 — parseWeights branches and format fallbacks", () => {
  it("parseWeights ignores malformed pairs and non-numeric values", () => {
    const yaml = `
weight_presets:
  messy: { l1: abc, l2: 0.4, l9: 1.0 }
agents:
  codex:
    eval:
      weights: { l1: , l2: 0.5, l3: 0.5 }
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.weightPresets.messy?.l2).toBe(0.4);
    expect(Number.isFinite(config.weightPresets.messy?.l1 ?? NaN)).toBe(false);
    expect(config.agents.codex?.eval?.weights?.l2).toBe(0.5);
  });

  it("formatEvalConfigYaml renders empty preset/agent/company fallbacks", () => {
    const config = buildDefaultEvalConfig();
    config.weightPresets = {};
    config.agents = {};
    config.companies = {};
    config.activePreset = null;
    config.cove = { enabled: false, maxVerificationQuestions: 2, parallelVerification: false };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("# no presets defined");
    expect(yaml).toContain("active_preset: null");
    expect(yaml).toContain("# per-agent overrides can be added here");
    expect(yaml).toContain("# per-company L3 weight overrides can be added here");
  });

  it("parseList strips bracket wrappers for compliance host lists", () => {
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
