// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const LOOPBACK = "http://localhost";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory-batch28d",
  MEM0_URL: "http://localhost:8080",
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(),
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(),
  queryGraphMemory: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn() })),
  })),
}));

describe("GET /api/memory/multi-search batch28d", () => {
  beforeEach(async () => {
    vi.resetModules();
    const parsers = await import("@/lib/parsers");
    const backends = await import("@/lib/memory/backends");
    vi.mocked(parsers.parseClaudeMemory).mockResolvedValue([]);
    vi.mocked(backends.searchVectorMemory).mockResolvedValue({ results: [] });
    vi.mocked(backends.queryGraphMemory).mockResolvedValue({ results: [] });
  });

  it("returns tier metrics with zero counts when backends are empty", async () => {
    const { GET } = await import("../multi-search/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch28d&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tiers: Array<{ tier: string; count: number; metric: { status: string } }>;
    };
    expect(body.tiers.some((t) => t.tier === "vector")).toBe(true);
    expect(body.tiers.every((t) => t.count === 0)).toBe(true);
  });

  it("accepts oversized limit query param without failing the route", async () => {
    const { GET } = await import("../multi-search/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=test&limit=999`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; query: string };
    expect(body.ok).toBe(true);
    expect(body.query).toBe("test");
  });
});
