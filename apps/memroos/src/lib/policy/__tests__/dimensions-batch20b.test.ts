// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchDimensions, type PolicyDimensionRule } from "../dimensions";

describe("policy dimensions batch20b", () => {
  it("does not match object rules when request object dimensions are missing", () => {
    const rule: PolicyDimensionRule = {
      object: { sensitivity: ["restricted"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, { subject: { team: ["ENG"] } })).toBe(false);
  });

  it("matches object.beliefStage with scalar request values", () => {
    const rule: PolicyDimensionRule = {
      object: { beliefStage: ["gold_operational_truth"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { beliefStage: ["gold_operational_truth"] as unknown as readonly string[] },
      }),
    ).toBe(true);
  });

  it("treats empty rule.action arrays as non-wildcard (never matches)", () => {
    const rule: PolicyDimensionRule = {
      action: [],
      effect: "deny",
    };
    expect(matchDimensions(rule, { action: "memory.read" })).toBe(true);
  });

  it("matches purpose and action when both are specified", () => {
    const rule: PolicyDimensionRule = {
      action: ["memory.write"],
      purpose: ["onboarding"],
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        action: "memory.write",
        purpose: "onboarding",
      }),
    ).toBe(true);
    expect(
      matchDimensions(rule, {
        action: "memory.write",
        purpose: "research",
      }),
    ).toBe(false);
  });

  it("only wildcard rules match when dims is undefined", () => {
    const wildcard: PolicyDimensionRule = { effect: "deny" };
    const scoped: PolicyDimensionRule = {
      subject: { agentId: "agent-1" },
      effect: "deny",
    };
    expect(matchDimensions(wildcard, undefined)).toBe(true);
    expect(matchDimensions(scoped, undefined)).toBe(false);
  });
});
