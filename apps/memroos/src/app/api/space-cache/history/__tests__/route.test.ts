// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { invalidateSpace } from "@/lib/space-cache";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { GET } = await import("../route");

describe("GET /api/space-cache/history", () => {
  let spaceId = "";

  beforeEach(() => {
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `cache-h-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    }).id;
    invalidateSpace(testDb, { spaceId, actorId: "agent-1", reason: "test" });
  });

  it("returns 401 without agent auth", async () => {
    const { authenticateAgentHeaders } = await import("@/lib/agent-registry");
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/space-cache/history?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when spaceId is missing", async () => {
    const res = await GET(new Request("http://localhost/api/space-cache/history") as never);
    expect(res.status).toBe(400);
  });

  it("returns invalidation history", async () => {
    const res = await GET(new Request(`http://localhost/api/space-cache/history?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.history.length).toBeGreaterThan(0);
  });
});
