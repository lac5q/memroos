// @vitest-environment node
import { describe, expect, it } from "vitest";

import { packContext } from "../context-pack";

describe("context-pack batch35b", () => {
  it("sorts by tier when evidence membership ties (116)", () => {
    const packed = packContext({
      items: [
        { id: "mem0-item", text: "m", score: 0.5, tier: "mem0" },
        { id: "lex-item", text: "l", score: 0.5, tier: "lexical" },
      ],
      budget: { maxBytes: 10_000, maxTokens: 10_000 },
    });
    expect(packed.items[0]?.id).toBe("lex-item");
    expect(packed.items[1]?.id).toBe("mem0-item");
  });

  it("surfaces temporal caveat codes on the receipt (163)", () => {
    const packed = packContext({
      items: [{ id: "a", text: "sample", score: 1, tier: "lexical" }],
      temporalCaveats: [
        { code: "candidate_stale", message: "older than window", candidateIds: ["a"] },
        { code: "no_timestamps", message: "clock drift", candidateIds: [] },
      ],
      budget: { maxBytes: 10_000, maxTokens: 10_000 },
    });
    expect(packed.receipt.temporalCaveatCodes).toEqual(["candidate_stale", "no_timestamps"]);
  });
});
