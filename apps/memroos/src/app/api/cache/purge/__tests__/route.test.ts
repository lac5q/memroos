// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const invalidateTag = vi.hoisted(() => vi.fn(() => 2));
const purge = vi.hoisted(() => vi.fn(() => 5));

vi.mock("@/lib/response-cache", () => ({
  responseCache: {
    invalidateTag: (...args: unknown[]) => invalidateTag(...args),
    purge: (...args: unknown[]) => purge(...args),
  },
}));

const { POST } = await import("../route");

describe("POST /api/cache/purge", () => {
  it("purges a specific tag when provided", async () => {
    const res = await POST(
      new Request("http://localhost/api/cache/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag: "memory" }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, purged: 2, tag: "memory" });
    expect(invalidateTag).toHaveBeenCalledWith("memory");
  });

  it("purges the full cache when tag is whitespace-only", async () => {
    const res = await POST(
      new Request("http://localhost/api/cache/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag: "   " }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, purged: 5, tag: null });
    expect(purge).toHaveBeenCalled();
  });

  it("returns 500 when cache invalidation throws", async () => {
    invalidateTag.mockImplementationOnce(() => {
      throw new Error("cache backend down");
    });
    const res = await POST(
      new Request("http://localhost/api/cache/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag: "memory" }),
      }) as never
    );
    expect(res.status).toBe(500);
  });

  it("purges the full cache when tag is omitted", async () => {
    const res = await POST(
      new Request("http://localhost/api/cache/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, purged: 5, tag: null });
    expect(purge).toHaveBeenCalled();
  });
});
