// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  deleteVaultConnection: vi.fn(() => true),
  appendActivityEvent: vi.fn(),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  deleteNangoConnection: vi.fn(async () => undefined),
  ToolAuthUpstreamError: class ToolAuthUpstreamError extends Error {
    status = 502;
  },
}));

const { POST } = await import("../route");

describe("POST /api/tools/disconnect", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/tools/disconnect", {
        method: "POST",
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown provider", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/tools/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "not-a-provider" }),
      }) as never
    );
    expect(res.status).toBe(404);
  });

  it("revokes known provider", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/tools/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(true);
  });
});
