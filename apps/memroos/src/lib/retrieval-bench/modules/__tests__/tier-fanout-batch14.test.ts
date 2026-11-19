// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RetrievedItem } from "../../schema";
import { performTierFanout } from "../tier-fanout";

describe("tier-fanout batch14", () => {
  it("denies tiers outside allowedTiers without calling them", async () => {
    const r = await performTierFanout({
      query: "q",
      sources: [{ tier: "qdrant", state: "registered" }],
      budget: { maxSources: 3, maxItemsPerSource: 2, deadlineMs: 500 },
      allowedTiers: ["lexical"],
    });
    expect(r.perSource[0]?.status).toBe("denied");
    expect(r.perSource[0]?.reasonCode).toBe("tier_not_allowed");
  });

  it("returns timeout when caller exceeds deadlineMs", async () => {
    let tick = 0;
    const r = await performTierFanout({
      query: "q",
      sources: [{ tier: "lexical", state: "registered" }],
      budget: { maxSources: 1, maxItemsPerSource: 2, deadlineMs: 0 },
      allowedTiers: ["lexical"],
      now: () => {
        tick += 1;
        return tick;
      },
      caller: async () => ({ items: [], durationMs: 0 }),
    });
    expect(r.perSource[0]?.status).toBe("timeout");
    expect(r.perSource[0]?.reasonCode).toBe("deadline_exceeded");
  });

  it("denies sources reporting zero trust at call time", async () => {
    const r = await performTierFanout({
      query: "q",
      sources: [{ tier: "lexical", state: "registered", trust: 0 }],
      budget: { maxSources: 1, maxItemsPerSource: 2, deadlineMs: 1000 },
      allowedTiers: ["lexical"],
      caller: async () => ({
        items: [{ id: "x", score: 1, text: "t", authorizationResult: "allowed", whyEntered: "ok", rankPosition: 1 } as RetrievedItem],
        trustAtCall: 0,
      }),
    });
    expect(r.perSource[0]?.status).toBe("denied");
    expect(r.perSource[0]?.reasonCode).toBe("zero_trust");
  });

  it("records failed status when caller throws", async () => {
    const r = await performTierFanout({
      query: "q",
      sources: [{ tier: "mem0", state: "registered" }],
      budget: { maxSources: 1, maxItemsPerSource: 2, deadlineMs: 1000 },
      allowedTiers: ["mem0"],
      caller: async () => {
        throw new Error("provider_unreachable");
      },
    });
    expect(r.perSource[0]?.status).toBe("failed");
    expect(r.perSource[0]?.reasonCode).toContain("provider_unreachable");
  });
});
