// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockSearchVector = vi.fn();
const mockQueryGraph = vi.fn();
const mockParseClaude = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: (...args: unknown[]) => mockSearchVector(...args),
  queryGraphMemory: (...args: unknown[]) => mockQueryGraph(...args),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: (...args: unknown[]) => mockParseClaude(...args),
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  mockSearchVector.mockReset();
  mockQueryGraph.mockReset();
  mockParseClaude.mockReset();
  mockParseClaude.mockResolvedValue([]);
  vi.resetModules();
});

describe("GET /api/memory/multi-search batch22 — normalizer edge shapes", () => {
  it("unwraps vector memories key and stringifies opaque objects", async () => {
    mockSearchVector.mockResolvedValue({
      memories: [{ nested: { title: "ignored" }, policy: "indexable", visibility: "internal" }],
    });
    mockQueryGraph.mockResolvedValue({
      results: [{ data: "not-an-array" }, { data: [{ row: [{ memory: "graph-hit batch22" }] }] }],
    });

    const { GET } = await import("../route");
    const q = `batch22-${randomUUID().slice(0, 8)}`;
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=${q}&limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const vectorTier = body.tiers.find((t: { tier: string }) => t.tier === "vector");
    expect(vectorTier.ok).toBe(true);
    expect(vectorTier.count).toBeGreaterThanOrEqual(1);
    expect(body.results.some((r: { content: string }) => r.content.includes("nested"))).toBe(true);
  });

  it("returns empty graph tier when results is not an array", async () => {
    mockSearchVector.mockResolvedValue([]);
    mockQueryGraph.mockResolvedValue({ results: "not-array" });

    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=graph-empty-batch22`));
    const body = await res.json();
    const graphTier = body.tiers.find((t: { tier: string }) => t.tier === "graph");
    expect(graphTier.count).toBe(0);
    expect(graphTier.metric.status).toBe("empty");
  });
});
