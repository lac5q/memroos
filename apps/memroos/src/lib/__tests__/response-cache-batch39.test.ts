// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createResponseCache } from "../response-cache";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("response cache batch39 — expired TTL getOrSet", () => {
  it("re-runs loader when entry expires (expiresAt <= now, ~58)", async () => {
    const cache = createResponseCache({ maxEntries: 4 });
    let calls = 0;

    const first = await cache.getOrSet("batch39", "ttl-expire", 1, async () => {
      calls += 1;
      return { pass: 1 };
    });
    expect(first).toEqual({ pass: 1 });
    expect(calls).toBe(1);

    await sleep(5);

    const second = await cache.getOrSet("batch39", "ttl-expire", 1, async () => {
      calls += 1;
      return { pass: 2 };
    });
    expect(second).toEqual({ pass: 2 });
    expect(calls).toBe(2);
    expect(cache.stats().misses).toBe(2);
  });
});