// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchDimensions, type PolicyDimensionRule } from "../dimensions";

describe("policy dimensions batch22c — scalar coercions and purpose guard rails", () => {
  it("rejects purpose rules when request purpose is absent", () => {
    const rule: PolicyDimensionRule = {
      purpose: ["onboarding"],
      effect: "deny",
    };
    expect(matchDimensions(rule, { action: "memory.read" })).toBe(false);
  });

  it("matches subject.team and subject.role with scalar request values", () => {
    const teamRule: PolicyDimensionRule = {
      subject: { team: ["ENG"] },
      effect: "deny",
    };
    expect(matchDimensions(teamRule, { subject: { team: "ENG" as unknown as string[] } })).toBe(true);
    expect(matchDimensions(teamRule, { subject: { team: "OTHER" as unknown as string[] } })).toBe(false);

    const roleRule: PolicyDimensionRule = {
      subject: { role: ["operator"] },
      effect: "deny",
    };
    expect(matchDimensions(roleRule, { subject: { role: "operator" as unknown as string[] } })).toBe(true);
  });

  it("matches object domain, sensitivity, visibility, beliefStage, and ontologyType scalars", () => {
    const domainRule: PolicyDimensionRule = {
      object: { domain: ["legal"] },
      effect: "deny",
    };
    expect(matchDimensions(domainRule, { object: { domain: "legal" } })).toBe(true);

    const sensitivityRule: PolicyDimensionRule = {
      object: { sensitivity: ["restricted"] },
      effect: "deny",
    };
    expect(matchDimensions(sensitivityRule, { object: { sensitivity: "restricted" } })).toBe(true);

    const visibilityRule: PolicyDimensionRule = {
      object: { visibility: ["internal"] },
      effect: "deny",
    };
    expect(matchDimensions(visibilityRule, { object: { visibility: "internal" } })).toBe(true);

    const beliefRule: PolicyDimensionRule = {
      object: { beliefStage: ["gold_operational_truth"] },
      effect: "deny",
    };
    expect(matchDimensions(beliefRule, { object: { beliefStage: "gold_operational_truth" } })).toBe(true);

    const ontologyRule: PolicyDimensionRule = {
      object: { ontologyType: ["memory.claim"] },
      effect: "deny",
    };
    expect(matchDimensions(ontologyRule, { object: { ontologyType: "memory.claim" } })).toBe(true);
  });
});
