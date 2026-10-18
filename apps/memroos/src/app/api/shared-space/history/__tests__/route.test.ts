// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { setSpaceShared } from "@/lib/shared-space";

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
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("GET /api/shared-space/history", () => {
  let spaceId = "";

  beforeEach(() => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `hist-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    }).id;
    setSpaceShared(testDb, { spaceId, isShared: true, actorId: "agent-1" });
  });

  it("returns 401 without agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/shared-space/history?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when spaceId is missing", async () => {
    const res = await GET(new Request("http://localhost/api/shared-space/history") as never);
    expect(res.status).toBe(400);
  });

  it("returns toggle history", async () => {
    const res = await GET(new Request(`http://localhost/api/shared-space/history?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBeGreaterThan(0);
  });
});
