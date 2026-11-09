// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/response-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/response-cache")>();
  return {
    ...actual,
    responseCache: {
      ...actual.responseCache,
      stats: () => ({ entries: 3, hits: undefined, misses: undefined }),
    },
  };
});

describe("GET /api/cache/stats batch22", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/response-cache");
  });

  it("reports unavailable hitRate when hits/misses counters are missing", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.metrics.hitRate.value).toBeNull();
    expect(body.metrics.hitRate.status).toBe("unavailable");
    expect(body.metrics.hitRate.reason).toMatch(/not yet populated/i);
  });
});
