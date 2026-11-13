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

describe("GET /api/memory/graph batch33", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    queryGraphMemory.mockReset();
    filterAuthorizedMemoryItems.mockReset();
    filterAuthorizedMemoryItems.mockImplementation((_, items: unknown[]) => items);
  });

  it("graphItems returns empty list for non-record backend payloads (L23)", async () => {
    queryGraphMemory.mockResolvedValueOnce("plain-string-backend");
    const res = await GET(new Request("http://localhost/api/memory/graph?q=batch33"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: "plain-string-backend" });
    expect(filterAuthorizedMemoryItems).toHaveBeenCalledWith(expect.anything(), [], expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("replaceGraphItems returns raw payload when shape is not array or results object (L37)", async () => {
    queryGraphMemory.mockResolvedValueOnce({ meta: "no-results-key" });
    filterAuthorizedMemoryItems.mockReturnValueOnce([]);
    const res = await GET(new Request("http://localhost/api/memory/graph?q=batch33b"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toEqual({ meta: "no-results-key" });
  });
});
