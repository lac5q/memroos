// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOOPBACK = "http://localhost";
const allowLabel = { visibility: "internal" as const, policy: "indexable" as const };

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory-batch29e",
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
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
  })),
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  extractMemoryLabelSnapshot: vi.fn(() => allowLabel),
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));

describe("GET /api/memory/multi-search batch29e — textFrom L64 and vectorItems L82", () => {
  beforeEach(async () => {
    vi.resetModules();
    const parsers = await import("@/lib/parsers");
    const backends = await import("@/lib/memory/backends");
    vi.mocked(parsers.parseClaudeMemory).mockResolvedValue([]);
    vi.mocked(backends.searchVectorMemory).mockResolvedValue({ results: [] });
    vi.mocked(backends.queryGraphMemory).mockResolvedValue({ results: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("textFrom returns empty for non-object vector items (line 64)", async () => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.searchVectorMemory).mockResolvedValue({
      results: [7, null, true, { memory: "keep-me", ...allowLabel }],
    });
    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch29e-textfrom&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ tier: string; content: string }> };
    const vector = body.results.filter((r) => r.tier === "vector");
    expect(vector).toHaveLength(1);
    expect(vector[0]?.content).toBe("keep-me");
  });

  it("vectorItems returns [] for non-object raw payloads (line 82)", async () => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.searchVectorMemory).mockResolvedValue(null as unknown as never);
    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch29e-null-vector&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tiers: Array<{ tier: string; metric: { status: string } }> };
    expect(body.tiers.find((t) => t.tier === "vector")?.metric.status).toBe("empty");
  });
});
