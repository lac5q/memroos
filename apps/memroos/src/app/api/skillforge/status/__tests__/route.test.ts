// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
}));

vi.mock("@/lib/skillforge", () => {
  class SkillForgeWorker {
    getStatus = vi.fn(() => ({ lastRunAt: null, lastStatus: "idle" }));
  }
  return {
    DEFAULT_SKILLFORGE_CONFIG: { cronSchedule: "0 * * * *", batchSize: 5, redactionEnabled: true },
    SkillForgeWorker,
  };
});

const { GET } = await import("../route");

describe("GET /api/skillforge/status", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("returns 401 without auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    expect((await GET(new Request("http://localhost/api/skillforge/status") as never)).status).toBe(401);
  });

  it("returns worker status", async () => {
    const res = await GET(new Request("http://localhost/api/skillforge/status") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lastStatus).toBe("idle");
    expect(body.config.batchSize).toBe(5);
  });

  it("returns 500 when database access throws", async () => {
    const dbModule = await import("@/lib/db");
    vi.spyOn(dbModule, "getDb").mockImplementationOnce(() => {
      throw new Error("db unavailable");
    });
    const res = await GET(new Request("http://localhost/api/skillforge/status") as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "db unavailable" });
  });
});
