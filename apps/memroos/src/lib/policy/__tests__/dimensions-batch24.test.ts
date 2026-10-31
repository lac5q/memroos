// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchDimensions, type PolicyDimensionRule } from "../dimensions";

describe("policy dimensions batch24 — array object fields and role arrays", () => {
  it("matches when request object fields are arrays", () => {
    const rule: PolicyDimensionRule = {
      object: {
        domain: ["finance", "legal"],
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
          domain: ["finance"],
          sensitivity: ["internal"],
          visibility: ["team"],
          beliefStage: ["candidate"],
          ontologyType: ["memory.claim"],
        },
      }),
    ).toBe(true);
    expect(matchDimensions(rule, { object: { domain: ["hr"] } })).toBe(false);
  });

  it("rejects subject role mismatches when request role is an array", () => {
    const rule: PolicyDimensionRule = {
      subject: { role: ["operator", "reviewer"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, { subject: { role: ["operator"] } })).toBe(true);
    expect(matchDimensions(rule, { subject: { role: ["guest"] } })).toBe(false);
    expect(matchDimensions(rule, { subject: {} })).toBe(false);
  });

  it("rejects subject team mismatches when request team is an array", () => {
    const rule: PolicyDimensionRule = {
      subject: { team: ["ENG", "OPS"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, { subject: { team: ["OPS"] } })).toBe(true);
    expect(matchDimensions(rule, { subject: { team: ["SALES"] } })).toBe(false);
  });
});
