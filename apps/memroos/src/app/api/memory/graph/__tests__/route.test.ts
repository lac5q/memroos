// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const queryGraphMemory = vi.hoisted(() => vi.fn());
const filterAuthorizedMemoryItems = vi.hoisted(() => vi.fn((_, items: unknown[]) => items));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/memory/backends", () => ({
  queryGraphMemory: (...args: unknown[]) => queryGraphMemory(...args),
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

describe("GET /api/memory/graph", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    queryGraphMemory.mockReset();
    filterAuthorizedMemoryItems.mockReset();
    filterAuthorizedMemoryItems.mockImplementation((_, items: unknown[]) => items);
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    expect((await GET(new Request("http://localhost/api/memory/graph?q=hi"))).status).toBe(403);
  });

  it("filters graph neighbors in the response", async () => {
    queryGraphMemory.mockResolvedValueOnce({
      results: [{ node: { id: "n1" }, neighbors: [{ id: "n2" }] }],
    });
    const res = await GET(new Request("http://localhost/api/memory/graph?q=edge&limit=10"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tier: "graph" });
  });

  it("returns 502 when graph backend is unavailable", async () => {
    queryGraphMemory.mockRejectedValueOnce(new Error("neo4j offline"));
    const res = await GET(new Request("http://localhost/api/memory/graph"));
    expect(res.status).toBe(502);
  });
});
