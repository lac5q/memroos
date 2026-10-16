// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const createNangoConnectSession = vi.hoisted(() =>
  vi.fn(async () => ({ connectLink: "https://connect.nango.dev/?session_token=test", sessionToken: "test" }))
);

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  createNangoConnectSession: (...args: unknown[]) => createNangoConnectSession(...args),
  ToolAuthConfigError: class ToolAuthConfigError extends Error {},
  ToolAuthUpstreamError: class ToolAuthUpstreamError extends Error {
    status = 502;
  },
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  appendActivityEvent: vi.fn(),
}));

const { POST } = await import("../route");

describe("POST /api/tools/connect/oauth", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    createNangoConnectSession.mockClear();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns authorize URL for oauth provider", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorizeUrl).toContain("connect.nango.dev");
    expect(body.providerKey).toBe("slack");
  });
});
