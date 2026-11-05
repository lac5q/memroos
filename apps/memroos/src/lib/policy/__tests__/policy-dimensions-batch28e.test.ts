// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchDimensions, type PolicyDimensionRule } from "../dimensions";

describe("policy dimensions batch28e — matchObject undefined req fields", () => {
  const fields = [
    "domain",
    "sensitivity",
    "visibility",
    "beliefStage",
    "ontologyType",
  ] as const;

  for (const field of fields) {
    it(`returns false when rule.object.${field} is set but request object omits ${field} (line 179 family)`, () => {
      const rule: PolicyDimensionRule = {
        object: { [field]: ["batch28e-value"] },
        effect: "deny",
      };
      expect(matchDimensions(rule, { object: {} })).toBe(false);
    });
  }

  it("matches scalar ontologyType on request object (line 213)", () => {
    const rule: PolicyDimensionRule = {
      object: { ontologyType: ["entity.Person"] },
      effect: "deny",
    };
    expect(
      matchDimensions(rule, {
        object: { ontologyType: "entity.Person" as unknown as string[] },
      }),
    ).toBe(true);
    expect(
      matchDimensions(rule, {
        object: { ontologyType: "entity.Other" as unknown as string[] },
      }),
    ).toBe(false);
  });

  it("matches array domain on request when rule lists overlap (lines 180-181)", () => {
    const rule: PolicyDimensionRule = {
      object: { domain: ["client", "internal"] },
      effect: "deny",
    };
    expect(matchDimensions(rule, { object: { domain: ["client"] } })).toBe(true);
    expect(matchDimensions(rule, { object: { domain: ["public"] } })).toBe(false);
  });
});
