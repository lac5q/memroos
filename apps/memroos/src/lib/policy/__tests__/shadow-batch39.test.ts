// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  activatePolicyVersion,
  shadowEvaluate,
  type ShadowDecisionRecord,
} from "../shadow";

describe("policy shadow batch39 — continue arms and activatePolicyVersion", () => {
  it("shadowEvaluate unchanged when proposed rule domain does not match request", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "recall.general",
          dimensions: { action: "recall.general", purpose: "batch39" },
        },
      },
    ];
    const diff = shadowEvaluate(
      {
        version: "proposed-b39-wrong-domain",
        rules: [
          {
            id: "deny-other-domain",
            domain: "vault-access",
            dimensions: {
              action: ["recall.general"],
              purpose: ["batch39"],
              effect: "deny",
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

  it("shadowEvaluate continues when proposed rule has no dimensions", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "export.flat",
          dimensions: { action: "export.flat", channel: "batch39" },
        },
      },
    ];
    const diff = shadowEvaluate(
      {
        version: "proposed-b39-no-dims",
        rules: [{ id: "rule-shell", domain: "memory-use" }],
      },
      recent,
    );
    expect(diff.unchanged).toBe(1);
    expect(diff.newlyDenied).toHaveLength(0);
  });

  it("shadowEvaluate continues when rule dimensions effect is not deny", () => {
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "allow",
        request: {
          domain: "memory-use",
          action: "recall.general",
          dimensions: { action: "recall.general", purpose: "batch39" },
        },
      },
    ];
    const diff = shadowEvaluate(
      {
        version: "proposed-b39-allow-effect",
        rules: [
          {
            id: "allow-only",
            domain: "memory-use",
            dimensions: {
              action: ["recall.general"],
              purpose: ["batch39"],
              effect: "allow" as "deny",
            },
          },
        ],
      },
      recent,
    );
    expect(diff.unchanged).toBe(1);
    expect(diff.newlyDenied).toHaveLength(0);
  });

  it("activatePolicyVersion returns empty_rules for null rules", () => {
    const result = activatePolicyVersion(
      {
        version: "2026.11.b39",
        rules: null as unknown as unknown[],
      },
      "2026.11.current",
    );
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("empty_rules");
    expect(result.newVersion).toBe("2026.11.current");
  });

  it("activatePolicyVersion returns empty_rules for non-array rules", () => {
    const result = activatePolicyVersion(
      {
        version: "2026.11.b39b",
        rules: { not: "an-array" } as unknown as unknown[],
      },
      "2026.11.current",
    );
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("empty_rules");
  });
});