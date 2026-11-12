// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { performTierFanout } from "../modules/tier-fanout";

describe("tier-fanout batch33 — source defaulting and sort tie-break (216, 255)", () => {
  it("fills missing item.source from tier (216)", async () => {
    const result = await performTierFanout({
      query: "batch33 source default",
      budget: { maxSources: 1, maxItemsPerSource: 2, deadlineMs: 5000 },
      sources: [{ tier: "lexical", state: "registered" }],
      caller: async () => ({
        items: [
          {
            id: `item-b33-${randomUUID().slice(0, 6)}`,
            score: 1,
            text: "a",
            tier: "lexical",
            authorizationResult: "allowed",
            whyEntered: "batch33",
            rankPosition: 0,
          },
        ],
        durationMs: 1,
      }),
    });
    expect(result.items[0]?.source).toBe("lexical");
  });

  it("sorts equal-score items by id ascending (255)", async () => {
    const result = await performTierFanout({
      query: "batch33 sort",
      budget: { maxSources: 1, maxItemsPerSource: 3, deadlineMs: 5000 },
      sources: [{ tier: "lexical", state: "registered" }],
      caller: async () => ({
        items: [
          {
            id: "z-b33",
            score: 5,
            text: "z",
            tier: "lexical",
            source: "lexical",
            authorizationResult: "allowed",
            whyEntered: "batch33",
            rankPosition: 0,
          },
          {
            id: "a-b33",
            score: 5,
            text: "a",
            tier: "lexical",
            source: "lexical",
            authorizationResult: "allowed",
            whyEntered: "batch33",
            rankPosition: 0,
          },
        ],
        durationMs: 1,
      }),
    });
    expect(result.items.map((i) => i.id)).toEqual(["a-b33", "z-b33"]);
  });
});
