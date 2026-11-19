// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authenticateUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

const { GET } = await import("../route");

describe("GET /api/belief/queue", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/belief/queue") as never)).status).toBe(401);
  });

  it("returns 403 for viewer role", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "v1",
      role: "reviewer",
      email: "reviewer@example.com",
      displayName: "Reviewer",
      tenantId: "default-tenant",
    });
    expect((await GET(new Request("http://localhost/api/belief/queue") as never)).status).toBe(403);
  });

  it("returns open review items for operator", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "op1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/belief/queue?limit=10") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});
