// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn());
const createNangoConnectSession = vi.hoisted(() =>
  vi.fn(async () => ({ connectLink: "https://connect.nango.dev/?session_token=test", sessionToken: "test" })),
);
const appendActivityEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/providers", () => ({
  getProvider: (key: string) => getProvider(key),
  isOAuthProvider: (provider: unknown) =>
    Boolean(provider && typeof provider === "object" && "providerConfigKey" in provider),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  createNangoConnectSession: (...args: unknown[]) => createNangoConnectSession(...args),
  ToolAuthConfigError: class ToolAuthConfigError extends Error {},
  ToolAuthUpstreamError: class ToolAuthUpstreamError extends Error {
    status = 502;
  },
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  appendActivityEvent: (...args: unknown[]) => appendActivityEvent(...args),
}));

const { POST } = await import("../route");

describe("POST /api/tools/connect/oauth batch25b", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    authenticateUser.mockResolvedValue({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    getProvider.mockImplementation((key: string) =>
      key === "slack"
        ? { key: "slack", providerConfigKey: "slack-mcp", authMode: "oauth" }
        : null,
    );
  });

  it("returns popup dimensions alongside authorizeUrl", async () => {
    const res = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.popupHeight).toBe(700);
    expect(body.authorizeUrl).toContain("connect.nango.dev");
  });
});
