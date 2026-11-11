// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  listActivityEvents: vi.fn(() => [{ type: "connection_established", providerKey: "example" }]),
}));

const { GET } = await import("../route");

describe("GET /api/tools/activity", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/tools/activity") as never);
    expect(res.status).toBe(401);
  });

  it("returns recent activity events", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/tools/activity?limit=3") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
  });
});
