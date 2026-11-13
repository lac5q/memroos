// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig, formatEvalConfigYaml, parseEvalConfigYaml } from "../config";

describe("evals config batch34 — inline presets, agents, and format optional branches", () => {
  it("parses inline weight_presets object and multiline agent golden_set (229-230, 235)", () => {
    const yaml = `
weight_presets:
  inline-b34: { l1: 0.1, l2: 0.2, l3: 0.7 }
agents:
  worker-b34:
    eval:
      golden_set: ./golden-sets/worker-b34.jsonl
      weights: { l1: 0.05, l2: 0.35, l3: 0.6 }
public_api:
  rate_limit:
    requests_per_minute: 90
    burst: 15
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.weightPresets["inline-b34"]).toEqual({ l1: 0.1, l2: 0.2, l3: 0.7 });
    expect(config.agents["worker-b34"]?.eval?.goldenSet).toContain("worker-b34");
    expect(config.agents["worker-b34"]?.eval?.weights?.l2).toBe(0.35);
    expect(config.publicApi?.rateLimit.requestsPerMinute).toBe(90);
  });

  it("formatEvalConfigYaml omits judge endpoint when unset and emits agent weight blocks (428-454)", () => {
    const config = buildDefaultEvalConfig();
    delete config.judgeModel.localEndpoint;
    config.agents = {
      "ops-b34": {
        eval: {
          goldenSet: "./golden-sets/ops-b34.jsonl",
          weights: { l1: 0.2, l2: 0.3, l3: 0.5 },
        },
      },
    };
    config.cove = { ...config.cove, judgeEndpoint: "" };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).not.toContain("local_endpoint:");
    expect(yaml).toContain("ops-b34:");
    expect(yaml).toContain("weights: { l1: 0.2, l2: 0.3, l3: 0.5 }");
    expect(yaml).not.toContain("judge_endpoint:");
  });

  it("formatEvalConfigYaml renders finance disabled defaults (437-442)", () => {
    const config = buildDefaultEvalConfig();
    config.finance = {
      enabled: false,
      transactionLabel: "txn-b34",
      reconciliationLabel: "recon-b34",
      exceptionLabel: "exc-b34",
      goldenSet: "./golden-sets/finance-b34.jsonl",
    };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("enabled: false");
    expect(yaml).toContain("transaction_label: txn-b34");
    expect(yaml).toContain("golden_set: ./golden-sets/finance-b34.jsonl");
  });
});
