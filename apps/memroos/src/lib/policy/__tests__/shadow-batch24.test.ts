// @vitest-environment node
import { describe, expect, it } from "vitest";

import { shadowEvaluate, type ProposedManifest, type ShadowDecisionRecord } from "../shadow";

describe("shadow batch24 — newlyDenied and unchanged buckets", () => {
  const denyRule: ProposedManifest = {
    version: "batch24-deny",
    rules: [
      {
        id: "rule-deny-export",
        domain: "memory-use",
        dimensions: {
          action: ["export"],
          effect: "deny",
        },
      },
    ],
  };

  it("records newlyDenied when a non-deny decision would flip to deny", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "export",
          dimensions: { action: "export" },
        },
      },
      {
        currentOutcome: "redact",
        request: {
          domain: "memory-use",
          action: "export",
          dimensions: { action: "export" },
        },
      },
    ];
    const result = shadowEvaluate(denyRule, recent);
    expect(result.newlyDenied).toHaveLength(2);
    expect(result.newlyDenied.every((e) => e.reason === "dimension_deny")).toBe(true);
    expect(result.newlyAllowed).toHaveLength(0);
    expect(result.unchanged).toBe(0);
  });

  it("counts unchanged when deny stays deny under an empty proposed manifest", () => {
    // newlyAllowed is unreachable with current proposedOutcomeFor: missing
    // rules preserve currentOutcome, so deny never becomes a non-deny.
    const emptyManifest: ProposedManifest = { version: "batch24-empty", rules: [] };
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "deny",
        request: {
          domain: "memory-use",
          action: "recall.general",
          dimensions: { action: "recall.general" },
        },
      },
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "recall.general",
          dimensions: { action: "recall.general" },
        },
      },
    ];
    const result = shadowEvaluate(emptyManifest, recent);
    expect(result.newlyAllowed).toHaveLength(0);
    expect(result.newlyDenied).toHaveLength(0);
    expect(result.unchanged).toBe(2);
  });
});
