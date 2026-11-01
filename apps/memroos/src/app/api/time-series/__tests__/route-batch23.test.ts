// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mockReadFileSync = vi.fn();

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { initSchema } = await import("@/lib/db-schema");
  const testDb = new Database(":memory:");
  initSchema(testDb);
  return { getDb: () => testDb };
});

vi.mock("@/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants")>();
  return {
    ...actual,
    SKILL_CONTRIBUTIONS_LOG: "/mock/skill-contributions.jsonl",
    FAILURES_LOG: "/mock/failures.log",
  };
});

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const LOOPBACK = "http://localhost";

describe("GET /api/time-series batch23 — JSONL edge branches", () => {
  it("skips malformed and out-of-window JSONL rows and buckets week windows via ts", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 40 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    mockReadFileSync.mockReturnValue(
      ["{bad-json", JSON.stringify({ ts: old, skill: "a" }), JSON.stringify({ ts: recent, skill: "b" })].join("\n")
    );
    const { GET } = await import("../route");
    const weekRes = await GET(
      new Request(`${LOOPBACK}/api/time-series?metric=skill_executions&window=week`) as never
    );
    const weekBody = await weekRes.json();
    expect(weekBody.window).toBe("week");
    expect(weekBody.points.reduce((sum: number, p: { value: number }) => sum + p.value, 0)).toBe(1);
  });
});
