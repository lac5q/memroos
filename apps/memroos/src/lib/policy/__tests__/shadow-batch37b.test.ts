// @vitest-environment node
import { describe, expect, it } from "vitest";

import { shadowEvaluate, type ShadowDecisionRecord } from "../shadow";

describe("policy shadow batch37b — additive replay branches", () => {
  it.skip("newlyAllowed arm (113) — proposedOutcomeFor preserves deny when proposed rules are empty", () => {});

  it("records newlyDenied when a proposed dimension rule tightens allow to deny (120-127)", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "recall.general",
          dimensions: { action: "recall.general", purpose: "batch37b" },
        },
      },
    ];
    const diff = shadowEvaluate(
      {
        version: "proposed-b37b",
        rules: [
          {
            id: "deny-recall-b37b",
            domain: "memory-use",
            dimensions: {
              action: ["recall.general"],
              purpose: ["batch37b"],
              effect: "deny",
            },
          },
        ],
      },
      recent,
    );
    expect(diff.newlyDenied).toHaveLength(1);
    expect(diff.newlyDenied[0]?.reason).toBe("dimension_deny");
  });
});