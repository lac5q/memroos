// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOOPBACK = "http://localhost";

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}));

describe("model-routing recommendations batch24", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/model-routing");
    vi.doUnmock("@/lib/response-cache");
  });

  it("GET returns 500 when cache lookup throws", async () => {
    vi.doMock("@/lib/response-cache", () => ({
      cacheKey: (parts: unknown[]) => parts.join(":"),
      responseCache: {
        getOrSet: async () => {
          throw new Error("cache failed batch24");
        },
      },
    }));
    const { GET } = await import("../route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/model-routing/recommendations?taskType=engineering`) as NextRequest,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "cache failed batch24" });
  });

  it("POST accepts non-string taskType and numeric limit branches", async () => {
    vi.doMock("@/lib/model-routing", () => ({
      recommendModels: vi.fn(() => [{ model: "claude-batch24", score: 1 }]),
    }));
    const { POST } = await import("../route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/model-routing/recommendations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskType: 123, strategy: "latency", limit: 12 }),
      }) as NextRequest,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskType).toBe("engineering");
    expect(body.strategy).toBe("latency");
    expect(body.recommendations).toHaveLength(1);
  });

  it("POST returns 500 when recommendModels throws", async () => {
    vi.doMock("@/lib/model-routing", () => ({
      recommendModels: () => {
        throw new Error("recommend failed batch24");
      },
    }));
    const { POST } = await import("../route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/model-routing/recommendations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskType: "sales", strategy: "quality", limit: 2 }),
      }) as NextRequest,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "recommend failed batch24" });
  });
});
