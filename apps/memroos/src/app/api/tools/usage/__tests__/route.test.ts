// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const getNangoUsage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  getNangoUsage: (...args: unknown[]) => getNangoUsage(...args),
  ToolAuthConfigError: class ToolAuthConfigError extends Error {},
  ToolAuthUpstreamError: class ToolAuthUpstreamError extends Error {
    status = 502;
    constructor(message: string) {
      super(message);
    }
  },
}));

const { GET } = await import("../route");

describe("GET /api/tools/usage", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    getNangoUsage.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/tools/usage") as never)).status).toBe(401);
  });

  it("returns usage payload", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    getNangoUsage.mockResolvedValueOnce({ used: 2, limit: 10 });
    const res = await GET(new Request("http://localhost/api/tools/usage") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage.used).toBe(2);
    expect(body.approachingLimit).toBe(false);
  });

  it("returns 503 when nango not configured", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const { ToolAuthConfigError } = await import("@/lib/tool-auth/nango-client");
    getNangoUsage.mockRejectedValueOnce(new ToolAuthConfigError("missing nango"));
    expect((await GET(new Request("http://localhost/api/tools/usage") as never)).status).toBe(503);
  });
});
