// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const runSkillCycle = vi.hoisted(() => vi.fn(async () => ({ ok: true, phase: "complete" })));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
}));

vi.mock("@/lib/skillforge/integration", () => ({
  runSkillCycle: (...args: unknown[]) => runSkillCycle(...args),
}));

vi.mock("@/lib/skillforge", () => ({
  DEFAULT_SKILLFORGE_CONFIG: { cronSchedule: "0 * * * *", batchSize: 5, redactionEnabled: true },
}));

const { POST } = await import("../route");

describe("POST /api/skillforge/cycle", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("returns 401 without auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    expect((await POST(new Request("http://localhost/api/skillforge/cycle", { method: "POST" }) as never)).status).toBe(
      401
    );
  });

  it("runs skill cycle", async () => {
    const res = await POST(new Request("http://localhost/api/skillforge/cycle", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 500 when the cycle throws", async () => {
    runSkillCycle.mockRejectedValueOnce(new Error("cycle failed"));
    const res = await POST(new Request("http://localhost/api/skillforge/cycle", { method: "POST" }) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "cycle failed" });
  });
});
