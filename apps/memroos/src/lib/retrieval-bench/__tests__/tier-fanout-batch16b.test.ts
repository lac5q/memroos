// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { FANOUT_STAGE_VERSION, performTierFanout } from "../modules/tier-fanout";

describe("tier-fanout batch16b — budgets, expiry, trust", () => {
  it("omits unregistered sources and respects tier allowlists", async () => {
    const result = await performTierFanout({
      query: "memory policy",
      scope: "tenant/default",
      budget: { maxSources: 2, maxItemsPerSource: 3, deadlineMs: 5000 },
      allowedTiers: ["lexical"],
      sources: [
        { tier: "lexical", state: "registered" },
        { tier: "mem0", state: "registered" },
        { tier: "qdrant", state: "unregistered" },
      ],
      caller: async () => ({ items: [], durationMs: 1 }),
      now: () => 1_700_000_000_000,
    });
    expect(result.receipt.stageVersion).toBe(FANOUT_STAGE_VERSION);
    expect(result.perSource.find((s) => s.tier === "mem0")?.status).toBe("denied");
    expect(result.perSource.find((s) => s.tier === "qdrant")?.status).toBe("denied");
  });

  it("marks expired registered sources as stale without calling", async () => {
    const result = await performTierFanout({
      query: "q",
      budget: { maxSources: 5, maxItemsPerSource: 2, deadlineMs: 1000 },
      sources: [{ tier: "vector-local", state: "registered", expiresAtIso: "2020-01-01T00:00:00.000Z" }],
      now: () => Date.parse("2026-07-01T00:00:00.000Z"),
    });
    expect(result.perSource[0]).toMatchObject({
      tier: "vector-local",
      status: "stale",
      reasonCode: "source_expired",
    });
  });

  it("records timeout, zero trust, and caller failures", async () => {
    let tick = 0;
    const slow = await performTierFanout({
      query: "slow",
      budget: { maxSources: 1, maxItemsPerSource: 1, deadlineMs: 1 },
      sources: [{ tier: "live", state: "registered" }],
      caller: async () => ({
        items: [],
        durationMs: 0,
      }),
      now: () => {
        tick += 1;
        return tick === 1 ? 1000 : 1005;
      },
    });
    expect(slow.perSource[0]?.status).toBe("timeout");

    const zeroTrust = await performTierFanout({
      query: "trust",
      budget: { maxSources: 1, maxItemsPerSource: 1, deadlineMs: 5000 },
      sources: [{ tier: "lexical", state: "registered", trust: 0 }],
      caller: async () => ({
        items: [
          {
            id: "1",
            score: 1,
            text: "x",
            tier: "lexical",
            source: "lexical",
            authorizationResult: "allowed",
            whyEntered: "test",
            rankPosition: 0,
          },
        ],
        trustAtCall: 0,
      }),
    });
    expect(zeroTrust.perSource[0]?.reasonCode).toBe("zero_trust");

    const failed = await performTierFanout({
      query: "boom",
      budget: { maxSources: 1, maxItemsPerSource: 1, deadlineMs: 5000 },
      sources: [{ tier: "mem0", state: "registered" }],
      caller: async () => {
        throw new Error("provider_down");
      },
    });
    expect(failed.perSource[0]?.status).toBe("failed");
    expect(failed.receipt.packHash).toMatch(/^sha256:/);
  });

  it("stops calling sources once maxSources budget is exhausted", async () => {
    const caller = vi.fn(async () => ({ items: [], durationMs: 1 }));
    await performTierFanout({
      query: "budget",
      budget: { maxSources: 1, maxItemsPerSource: 1, deadlineMs: 5000 },
      sources: [
        { tier: "lexical", state: "registered" },
        { tier: "mem0", state: "registered" },
      ],
      caller,
    });
    expect(caller).toHaveBeenCalledTimes(1);
  });
});
