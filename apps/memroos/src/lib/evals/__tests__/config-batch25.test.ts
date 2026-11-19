// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch25 — parseWeights empty, agents, presets, format branches", () => {
  it("parseEvalConfigYaml accepts empty inline weights object via parseWeights early return", () => {
    const yaml = `
weight_presets:
  empty-inline: {}
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
    expect(config.weightPresets["empty-inline"]).toEqual({ l1: 0.2, l2: 0.5, l3: 0.3 });
  });

  it("parses multi-line weight preset fields and agent eval overrides", () => {
    const yaml = `
weight_presets:
  custom-preset:
    l1: 0.15
    l2: 0.35
    l3: 0.50
agents:
  codex-cli:
    eval:
      golden_set: ./golden-sets/codex.jsonl
      weights: { l1: 0.1, l2: 0.2, l3: 0.7 }
public_api:
  rate_limit:
    requests_per_minute: 120
    burst: 25
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
    expect(config.weightPresets["custom-preset"]).toEqual({ l1: 0.15, l2: 0.35, l3: 0.5 });
    expect(config.agents["codex-cli"]?.eval?.goldenSet).toBe("./golden-sets/codex.jsonl");
    expect(config.agents["codex-cli"]?.eval?.weights).toEqual({ l1: 0.1, l2: 0.2, l3: 0.7 });
    expect(config.publicApi?.rateLimit.requestsPerMinute).toBe(120);
    expect(config.publicApi?.rateLimit.burst).toBe(25);
  });

  it("formatEvalConfigYaml renders agent weight blocks and null active preset", () => {
    const config = buildDefaultEvalConfig();
    config.activePreset = null;
    config.agents = {
      "review-bot": {
        eval: {
          goldenSet: "./golden-sets/review.jsonl",
          weights: { l1: 0.05, l2: 0.15, l3: 0.8 },
        },
      },
    };
    config.cove = {
      enabled: true,
      maxVerificationQuestions: 5,
      parallelVerification: true,
      judgeEndpoint: "http://localhost:8080/judge",
    };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("active_preset: null");
    expect(yaml).toContain("review-bot:");
    expect(yaml).toContain("weights: { l1: 0.05, l2: 0.15, l3: 0.8 }");
    expect(yaml).toContain("judge_endpoint: http://localhost:8080/judge");
  });
});
