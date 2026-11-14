// @vitest-environment node
import { randomUUID } from "node:crypto";
import { EventEmitter } from "events";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import type { MemoryEntry } from "@/types";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockSearchVector = vi.fn();
const mockQueryGraph = vi.fn();
const mockParseClaude = vi.fn();
const mockAuthenticateUser = vi.fn();

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

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  mockSearchVector.mockReset();
  mockQueryGraph.mockReset();
  mockParseClaude.mockReset();
  mockAuthenticateUser.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "u1",
    role: "operator",
    email: "op@example.com",
  });
  process.env.HOME = "/tmp";
  vi.resetModules();
});

describe("batch16 — GET /api/memory/multi-search", () => {
  it("returns 400 when query param is missing", async () => {
    const { GET } = await import("../memory/multi-search/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search`));
    expect(res.status).toBe(400);
  });

  it("normalizes vector, graph, and episodic tiers with mixed backend shapes", async () => {
    mockSearchVector.mockResolvedValue({
      results: [
        { memory: "batch16 vector recall terms", score: 0.91, policy: "indexable", visibility: "internal" },
        "plain-string-hit batch16 vector recall terms",
        { content: { nested: "ignored" } },
      ],
    });
    mockQueryGraph.mockResolvedValue({
      results: [
        {
          data: [
            {
              row: [
                { memory: "graph node batch16 vector recall terms", policy: "indexable", visibility: "internal" },
                { rel: "KNOWS" },
                [],
              ],
            },
          ],
        },
      ],
    });
    const episodic: MemoryEntry[] = [
      {
        id: "e1",
        content: "batch16 vector recall terms in episodic lane",
        agent: "agent-1",
        date: "2026-01-01",
        type: "reference",
        source: "claude",
        score: 0.5,
      },
    ];
    mockParseClaude.mockResolvedValue(episodic);

    const { GET } = await import("../memory/multi-search/route");
    const res = await GET(
      new Request(`${LOOPBACK}/api/memory/multi-search?q=batch16+vector+recall+terms&limit=5`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tiers).toHaveLength(3);
    const vectorTier = body.tiers.find((t: { tier: string }) => t.tier === "vector");
    expect(vectorTier.ok).toBe(true);
    expect(vectorTier.metric.status).toBe("live");
    expect(body.results.length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces backend errors as tier error metrics without throwing", async () => {
    mockSearchVector.mockRejectedValue(new Error("qdrant offline"));
    mockQueryGraph.mockRejectedValue("graph down");
    mockParseClaude.mockRejectedValue(new Error("missing episodic file"));

    const { GET } = await import("../memory/multi-search/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=test-${randomUUID()}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tiers.every((t: { ok: boolean }) => t.ok === false)).toBe(true);
    expect(body.results).toEqual([]);
    expect(body.tiers[0].metric.status).toBe("error");
  });

  it("marks tier blocked when policy gate denies all raw hits", async () => {
    mockSearchVector.mockResolvedValue([
      { memory: "sealed secret batch16 blocked", policy: "sealed", visibility: "internal" },
    ]);
    mockQueryGraph.mockResolvedValue({ results: [] });
    mockParseClaude.mockResolvedValue([]);

    const { GET } = await import("../memory/multi-search/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/multi-search?q=batch16+blocked`));
    const body = await res.json();
    const vectorTier = body.tiers.find((t: { tier: string }) => t.tier === "vector");
    expect(vectorTier.metric.status).toBe("blocked");
    expect(body.results).toEqual([]);
  });
});

describe("batch16 — POST /api/library/qmd-update SSE branches", () => {
  it("streams failure when qmd child exits non-zero", async () => {
    const { spawn } = await import("child_process");
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 9001;
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      child.killed = true;
    });
    vi.mocked(spawn).mockImplementation(() => {
      setImmediate(() => child.emit("close", 2));
      return child as never;
    });

    const { POST } = await import("../library/qmd-update/route");
    const res = await POST(new Request(`${LOOPBACK}/api/library/qmd-update`, { method: "POST" }) as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"failed"');
    expect(text).toContain("exited with code 2");
  });
});
