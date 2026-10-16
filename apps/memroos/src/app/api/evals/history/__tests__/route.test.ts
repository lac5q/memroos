// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

vi.mock("@/lib/db", () => ({
  getDb: () => db,
  closeDb: () => {},
}));

const listEvalRuns = vi.hoisted(() => vi.fn(() => [{ id: "run-1" }]));

vi.mock("@/lib/evals/persistence", () => ({
  listEvalRuns: (...args: unknown[]) => listEvalRuns(...args),
}));

const { GET } = await import("../route");

describe("GET /api/evals/history", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    listEvalRuns.mockClear();
  });

  it("returns eval run history with a clamped limit", async () => {
    const res = GET(new Request("http://localhost/api/evals/history?limit=500") as never);
    expect((await res).status).toBe(200);
    const body = await (await res).json();
    expect(body.runs).toEqual([{ id: "run-1" }]);
    expect(listEvalRuns).toHaveBeenCalledWith(db, 100);
  });

  it("returns 500 when listing eval runs throws", async () => {
    listEvalRuns.mockImplementationOnce(() => {
      throw new Error("db locked");
    });
    const res = GET(new Request("http://localhost/api/evals/history") as never);
    expect((await res).status).toBe(500);
  });

  it("falls back to the default limit for invalid query values", async () => {
    const res = GET(new Request("http://localhost/api/evals/history?limit=not-a-number") as never);
    expect((await res).status).toBe(200);
    expect(listEvalRuns).toHaveBeenCalledWith(db, 25);
  });
});
