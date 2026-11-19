// @vitest-environment node
import { describe, expect, it } from "vitest";

import { shadowEvaluate, type ProposedManifest, type ShadowDecisionRecord } from "../shadow";

describe("shadow batch23 — proposed replay preserves deny without matching rules", () => {
  it("keeps deny decisions unchanged when proposed manifest has no matching dimension rules", () => {
    const emptyManifest: ProposedManifest = { version: "batch23-empty", rules: [] };
    const recent: ShadowDecisionRecord[] = [
      {
        currentOutcome: "deny",
        request: { domain: "memory-use", action: "recall.general" },
      },
    ];
    const result = shadowEvaluate(emptyManifest, recent);
    expect(result.newlyAllowed).toHaveLength(0);
    expect(result.newlyDenied).toHaveLength(0);
    expect(result.unchanged).toBe(1);
  });
});
