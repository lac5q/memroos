// @vitest-environment node
import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const parseModelUsage = vi.fn();
const parseTokenStats = vi.fn();

vi.mock("@/lib/parsers", () => ({
  parseModelUsage,
  parseTokenStats,
}));

const emptyUsage = {
  models: [] as Array<{ id: string }>,
  total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 },
};

describe("GET /api/model-usage", () => {
  beforeEach(async () => {
    vi.resetModules();
    parseModelUsage.mockReset();
    parseTokenStats.mockReset();
    parseModelUsage.mockResolvedValue(emptyUsage);
    parseTokenStats.mockReturnValue(null);
  });

  it("returns merged usage from claude, ledger, and rtk sources", async () => {
    parseModelUsage.mockResolvedValue({
      models: [{ id: "claude", name: "Claude", inputTokens: 1, outputTokens: 2, cacheRead: 0, cacheCreation: 0, requests: 1, totalTokens: 3 }],
      total: { inputTokens: 1, outputTokens: 2, cacheRead: 0, cacheCreation: 0, requests: 1 },
    });
    parseTokenStats.mockReturnValue({ totalInput: 5, totalOutput: 6, totalCommands: 1 });
    const { GET } = await import("../route");
    const req = new NextRequest("http://localhost/api/model-usage");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usage.models.length).toBeGreaterThan(0);
    expect(data.sources).toMatchObject({
      claudeJsonlModels: 1,
      rtkModels: 1,
    });
  });

  it("accepts since query parameter", async () => {
    const { GET } = await import("../route");
    const req = new NextRequest("http://localhost/api/model-usage?since=2026-01-01T00:00:00.000Z");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(parseModelUsage).toHaveBeenCalledWith(expect.any(Date));
  });

  it("returns 500 when parsing throws", async () => {
    parseModelUsage.mockRejectedValue(new Error("parse failed"));
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/model-usage"));
    expect(res.status).toBe(500);
  });
});
