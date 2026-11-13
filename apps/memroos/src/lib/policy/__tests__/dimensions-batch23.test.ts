// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchDimensions, type PolicyDimensionRule } from "../dimensions";

describe("policy dimensions batch23 — subject identity and object scalar guards", () => {
  it("rejects subject.userId and subject.agentId mismatches", () => {
    const userRule: PolicyDimensionRule = {
      subject: { userId: "user-a" },
      effect: "deny",
    };
    expect(matchDimensions(userRule, { subject: { userId: "user-a" } })).toBe(true);
    expect(matchDimensions(userRule, { subject: { userId: "user-b" } })).toBe(false);
    expect(matchDimensions(userRule, { subject: {} })).toBe(false);

    const agentRule: PolicyDimensionRule = {
      subject: { agentId: "agent-a" },
      effect: "deny",
    };
    expect(matchDimensions(agentRule, { subject: { agentId: "agent-a" } })).toBe(true);
    expect(matchDimensions(agentRule, { subject: { agentId: "agent-b" } })).toBe(false);
  });

  it("matches object scalars when request fields are singular strings", () => {
    const rule: PolicyDimensionRule = {
      object: {
        domain: ["finance"],
        sensitivity: ["internal"],
        visibility: ["team"],
        beliefStage: ["candidate"],
        ontologyType: ["memory.claim"],
      },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: {
          domain: "finance",
          sensitivity: "internal",
          visibility: "team",
          beliefStage: "candidate",
          ontologyType: "memory.claim",
        },
      }),
    ).toBe(true);
    expect(matchDimensions(rule, { object: { domain: "legal" } })).toBe(false);
  });

  it("requires subject team/role arrays when rule lists are non-empty", () => {
    const teamRule: PolicyDimensionRule = {
      subject: { team: ["ENG"] },
      effect: "deny",
    };
    expect(matchDimensions(teamRule, { subject: { team: ["ENG"] } })).toBe(true);
    expect(matchDimensions(teamRule, { subject: {} })).toBe(false);

    const roleRule: PolicyDimensionRule = {
      subject: { role: ["operator"] },
      effect: "deny",
    };
    expect(matchDimensions(roleRule, { subject: { role: "operator" as unknown as string[] } })).toBe(true);
    expect(matchDimensions(roleRule, { subject: { role: ["reviewer"] } })).toBe(false);
  });
});
