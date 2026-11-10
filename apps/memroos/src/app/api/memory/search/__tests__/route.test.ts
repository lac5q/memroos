// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const searchVectorMemory = vi.hoisted(() => vi.fn());
const filterAuthorizedMemoryItems = vi.hoisted(() => vi.fn((_, items: unknown[]) => items));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: (...args: unknown[]) => searchVectorMemory(...args),
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  filterAuthorizedMemoryItems: (...args: unknown[]) => filterAuthorizedMemoryItems(...args),
  extractMemoryLabelSnapshot: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
  closeDb: () => {},
}));

const { GET } = await import("../route");

describe("GET /api/memory/search", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    searchVectorMemory.mockReset();
    filterAuthorizedMemoryItems.mockReset();
    filterAuthorizedMemoryItems.mockImplementation((_, items: unknown[]) => items);
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    expect((await GET(new Request("http://localhost/api/memory/search?q=hi"))).status).toBe(403);
  });

  it("returns filtered vector search results", async () => {
    searchVectorMemory.mockResolvedValueOnce({ results: [{ id: "m1", text: "hello" }] });
    const res = await GET(new Request("http://localhost/api/memory/search?q=hello&limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.results).toHaveLength(1);
  });

  it("returns 502 when vector backend is unavailable", async () => {
    searchVectorMemory.mockRejectedValueOnce(new Error("qdrant offline"));
    const res = await GET(new Request("http://localhost/api/memory/search?q=hello"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, tier: "vector" });
  });
});
