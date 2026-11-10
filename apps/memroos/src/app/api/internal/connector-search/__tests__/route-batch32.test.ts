// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => getDb(),
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
}));

beforeEach(() => {
  getDb.mockReset();
});

describe("GET /api/internal/connector-search batch32", () => {
  it("falls back to plain query when quoted FTS fails (lines 103-104)", async () => {
    getDb.mockReturnValue({
      prepare: () => ({
        all: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error("fts quote imbalance");
          })
          .mockReturnValueOnce([{ session_id: "s1", content: "plain hit" }]),
      }),
    });
    const { GET } = await import("../route");
    const res = await GET(
      new Request('http://localhost/api/internal/connector-search?q="broken&limit=5') as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.results).toHaveLength(1);
  });

  it("returns 500 when database prepare throws (lines 109-110)", async () => {
    getDb.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    const { GET } = await import("../route");
    const res = await GET(
      new Request(`http://localhost/api/internal/connector-search?q=fail-${Date.now()}`) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.error).toMatch(/db unavailable/);
  });
});
