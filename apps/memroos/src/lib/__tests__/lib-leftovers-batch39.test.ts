// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { parseEvalConfigYaml } from "@/lib/evals/config";
import { checkDispatchPolicy } from "@/lib/security-policy";
import { hasValidUnderstandGraphToken } from "@/lib/understand-graph";
import type { RemoteAgentConfig } from "@/types";

const companyBlock = `
companies:
  solo_b39:
    l3_sub_weights:
      completion_rate: 0.35
      escalation_rate: 0.25
      ttr_p50: 0.20
      operator_approval_rate: 0.10
      cost_per_task: 0.10
`;

function remoteAgent(host: string): RemoteAgentConfig {
  return {
    id: `remote-b39-${randomUUID().slice(0, 6)}`,
    name: "Remote batch39",
    role: "Worker",
    platform: "codex",
    protocol: "rest",
    host,
    skills: [{ id: "task:accept", name: "Accept", description: "", tags: [] }],
  };
}

describe("lib leftovers batch39", () => {
  afterEach(() => {
    delete process.env.UNDERSTAND_GRAPH_TOKEN;
    delete process.env.MEMROOS_A2A_PROFILE;
    delete process.env.MEMROOS_A2A_ALLOW_PRIVATE_NETWORK_CARDS;
  });

  it("hasValidUnderstandGraphToken returns true when query token matches (understand-graph 24-32)", () => {
    const token = randomUUID();
    process.env.UNDERSTAND_GRAPH_TOKEN = token;
    expect(
      hasValidUnderstandGraphToken(
        new Request(`http://localhost:3000/api/understand/graph?token=${encodeURIComponent(token)}`),
      ),
    ).toBe(true);
  });

  it("hasValidUnderstandGraphToken returns false when query token mismatches", () => {
    process.env.UNDERSTAND_GRAPH_TOKEN = "configured-b39";
    expect(
      hasValidUnderstandGraphToken(new Request("http://localhost:3000/api/understand/graph?token=wrong-b39")),
    ).toBe(false);
  });

  it.each(["::1", "172.16.0.1", "100.64.0.1"])(
    "checkDispatchPolicy denies private host %s when allowPrivateNetworkCards is false",
    (host) => {
      process.env.MEMROOS_A2A_PROFILE = "cloud-https";
      process.env.MEMROOS_A2A_ALLOW_PRIVATE_NETWORK_CARDS = "0";
      const decision = checkDispatchPolicy("caller-b39", remoteAgent(host));
      expect(decision).toMatchObject({ allowed: false, code: "NETWORK_POLICY_DENIED", detail: { host } });
    },
  );

  it('parseEvalConfigYaml preserves quoted empty active_preset as empty string, not null (config.ts 260-264)', () => {
    const yaml = `
active_preset: ""
${companyBlock}`;
    const parsed = parseEvalConfigYaml(yaml);
    // Unlike bare `active_preset:` (null) or `active_preset: ""` on the raw map, quoted empty strips to "" and stays in the truthy branch.
    expect(parsed.activePreset).toBe("");
    expect(parsed.activePreset).not.toBeNull();
  });

  it("parseEvalConfigYaml keeps named active_preset after quote strip", () => {
    const yaml = `
active_preset: "outcome-weighted"
${companyBlock}`;
    expect(parseEvalConfigYaml(yaml).activePreset).toBe("outcome-weighted");
  });
});