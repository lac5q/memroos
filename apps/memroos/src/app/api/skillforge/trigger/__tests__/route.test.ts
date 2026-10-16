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
    run = vi.fn(async () => ({
      runId: "run-1",
      status: "success",
      entriesProcessed: 1,
      proposalsCreated: 0,
      proposalsSubmitted: 0,
      errors: [],
    }));
  }
  return {
    DEFAULT_SKILLFORGE_CONFIG: { cronSchedule: "0 * * * *", batchSize: 5, redactionEnabled: true },
    SkillForgeWorker,
  };
});

const { POST } = await import("../route");

describe("POST /api/skillforge/trigger", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("returns 401 without auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    expect((await POST(new Request("http://localhost/api/skillforge/trigger", { method: "POST" }) as never)).status).toBe(
      401
    );
  });

  it("runs worker", async () => {
    const res = await POST(new Request("http://localhost/api/skillforge/trigger", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.runId).toBe("run-1");
  });

  it("returns 500 when database access throws", async () => {
    const dbModule = await import("@/lib/db");
    vi.spyOn(dbModule, "getDb").mockImplementationOnce(() => {
      throw new Error("db unavailable");
    });
    const res = await POST(new Request("http://localhost/api/skillforge/trigger", { method: "POST" }) as never);
    expect(res.status).toBe(500);
  });
});
