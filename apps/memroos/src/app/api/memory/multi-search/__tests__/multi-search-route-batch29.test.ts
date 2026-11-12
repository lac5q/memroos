// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOOPBACK = "http://localhost";

const allowLabel = { visibility: "internal" as const, policy: "indexable" as const };

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory-batch29",
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

describe("GET /api/memory/multi-search batch29 — normalization branches", () => {
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

  it("JSON-stringifies vector items that lack string memory fields", async () => {
    const backends = await import("@/lib/memory/backends");
    const structured = { depth: 99, note: "batch29-json-fallback" };
    vi.mocked(backends.searchVectorMemory).mockResolvedValue({
      memories: [
        {
          ...structured,
          ...allowLabel,
        },
      ],
    });

    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch29-fallback&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ content: string; tier: string }> };
    const vectorHit = body.results.find((r) => r.tier === "vector");
    expect(vectorHit?.content).toBe(JSON.stringify({ ...structured, ...allowLabel }));
  });

  it("treats vector wrapper objects without array arms as empty", async () => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.searchVectorMemory).mockResolvedValue({ count: 3, payload: "not-an-array" });

    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch29-empty-vector&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tiers: Array<{ tier: string; metric: { status: string } }> };
    const vector = body.tiers.find((t) => t.tier === "vector");
    expect(vector?.metric.status).toBe("empty");
  });

  it.each([
    ["results", { results: [{ memory: "from-results-arm", ...allowLabel }] }],
    ["memories", { memories: [{ text: "from-memories-arm", ...allowLabel }] }],
    ["data", { data: [{ title: "from-data-arm", ...allowLabel }] }],
  ] as const)("unwraps vector hits from %s", async (_key, raw) => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.searchVectorMemory).mockResolvedValue(raw);

    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch29-unwrap&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ tier: string; content: string }> };
    expect(body.results.some((r) => r.tier === "vector" && r.content.length > 0)).toBe(true);
  });

  it("skips non-object graph result rows when flattening", async () => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.queryGraphMemory).mockResolvedValue({
      results: [
        null,
        "skip-string-result",
        {
          data: [
            {
              row: [{ label: "n1", ...allowLabel }],
            },
          ],
        },
      ],
    });

    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch29-graph-skip&limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ tier: string; content: string }> };
    expect(body.results.some((r) => r.tier === "graph" && r.content.includes("n1"))).toBe(true);
  });
});
