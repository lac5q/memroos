// @vitest-environment node
import { describe, expect, it } from "vitest";

import { shadowEvaluate, type ShadowDecisionRecord } from "../shadow";

describe("policy shadow batch38 — tighten-deny and proposed rule skips", () => {
  it.skip("newlyAllowed arm (112–118) — proposedOutcomeFor cannot loosen deny without matching rules", () => {});

  it("records newlyDenied for redact currentOutcome when proposed rule tightens (120–127)", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "redact",
        request: {
          domain: "memory-use",
          action: "export.flat",
          dimensions: { action: "export.flat", channel: "batch38" },
        },
      },
    ];
    const diff = shadowEvaluate(
      {
        version: "proposed-b38",
        rules: [
          {
            id: "deny-export-b38",
            domain: "memory-use",
            dimensions: {
              action: ["export.flat"],
              channel: ["batch38"],
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

  it("unchanged when proposed deny rule does not match request dimensions (149–155)", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "recall.general",
          dimensions: { action: "recall.general", purpose: "batch38" },
        },
      },
    ];
    const diff = shadowEvaluate(
      {
        version: "proposed-b38-miss",
        rules: [
          {
            id: "deny-other-purpose",
            domain: "memory-use",
            dimensions: {
              action: ["recall.general"],
              purpose: ["other"],
              effect: "deny",
            },
          },
          {
            id: "allow-effect-only",
            domain: "memory-use",
            dimensions: {
              action: ["recall.general"],
              purpose: ["batch38"],
              effect: "allow",
            },
          },
        ],
      },
      recent,
    );
    expect(diff.newlyDenied).toHaveLength(0);
    expect(diff.newlyAllowed).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });
});