// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildDefaultEvalConfig,
  formatEvalConfigYaml,
  parseEvalConfigYaml,
} from "../config";

describe("evals config batch31 — finance/public_api parse and format optional branches", () => {
  it("parses finance, public_api rate limits, and multiline weight preset keys", () => {
    const yaml = `
judge_model:
  local_endpoint: http://localhost:11434/v1
public_api:
  rate_limit:
    requests_per_minute: 120
    burst: 25
finance:
  enabled: true
  transaction_label: txn-b31
  golden_set: ./golden-sets/finance-b31.jsonl
weight_presets:
  multiline-b31:
    l1: 0.15
    l2: 0.55
    l3: 0.30
cove:
  judge_endpoint: http://localhost:8080/judge
companies:
  acme_b31:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    const config = parseEvalConfigYaml(yaml);
    expect(config.judgeModel.localEndpoint).toBe("http://localhost:11434/v1");
    expect(config.publicApi?.rateLimit.requestsPerMinute).toBe(120);
    expect(config.publicApi?.rateLimit.burst).toBe(25);
    expect(config.finance?.enabled).toBe(true);
    expect(config.finance?.transactionLabel).toBe("txn-b31");
    expect(config.weightPresets["multiline-b31"]).toEqual({ l1: 0.15, l2: 0.55, l3: 0.3 });
    expect(config.cove.judgeEndpoint).toBe("http://localhost:8080/judge");
  });

  it("formatEvalConfigYaml emits judge local_endpoint, finance block, and agent without weights", () => {
    const config = buildDefaultEvalConfig();
    config.judgeModel.localEndpoint = "http://batch31-judge";
    config.finance = {
      enabled: true,
      transactionLabel: "txn",
      reconciliationLabel: "recon",
      exceptionLabel: "exc",
      goldenSet: "./golden-sets/finance-b31.jsonl",
    };
    config.agents = {
      "worker-b31": { eval: { goldenSet: "./golden-sets/worker-b31.jsonl" } },
    };
    config.cove = { ...config.cove, judgeEndpoint: "http://batch31-cove" };
    const yaml = formatEvalConfigYaml(config);
    expect(yaml).toContain("local_endpoint: http://batch31-judge");
    expect(yaml).toContain("finance:");
    expect(yaml).toContain("transaction_label: txn");
    expect(yaml).toContain("worker-b31:");
    expect(yaml).toContain("weights: {}");
    expect(yaml).toContain("judge_endpoint: http://batch31-cove");
  });

  it("throws when company l3_sub_weights do not sum to 1.0", () => {
    const yaml = `
companies:
  bad_b31:
    l3_sub_weights:
      completion_rate: 0.50
      escalation_rate: 0.50
      ttr_p50: 0.10
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;
    expect(() => parseEvalConfigYaml(yaml)).toThrow(/must sum to 1\.0/);
  });
});
