// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn());
const createNangoConnectSession = vi.hoisted(() =>
  vi.fn(async () => ({ connectLink: "https://connect.nango.dev/?session_token=test", sessionToken: "test" }))
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

const operatorSession = {
  userId: "u1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Op",
  tenantId: "default-tenant",
};

describe("POST /api/tools/connect/oauth", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    authenticateUser.mockResolvedValue(operatorSession);
    createNangoConnectSession.mockReset();
    createNangoConnectSession.mockResolvedValue({
      connectLink: "https://connect.nango.dev/?session_token=test",
      sessionToken: "test",
    });
    appendActivityEvent.mockClear();
    getProvider.mockImplementation((key: string) =>
      key === "slack"
        ? { key: "slack", providerConfigKey: "slack-mcp", authMode: "oauth" }
        : key === "demo-api"
          ? { key: "demo-api", authMode: "api-key" }
          : null,
    );
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
    authenticateUser.mockResolvedValueOnce(operatorSession);
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
    expect(body.popupWidth).toBe(600);
    expect(appendActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ providerKey: "slack", type: "connection_established" }),
    );
  });

  it("returns 400 for invalid JSON bodies", async () => {
    authenticateUser.mockResolvedValueOnce(operatorSession);
    const res = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }) as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid JSON" });
  });

  it("returns 404 for unknown or non-oauth providers", async () => {
    const missing = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "missing" }),
      }) as never
    );
    expect(missing.status).toBe(404);

    const apiKey = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "demo-api" }),
      }) as never
    );
    expect(apiKey.status).toBe(404);
  });

  it("maps Nango configuration and upstream failures to typed HTTP errors", async () => {
    const { ToolAuthConfigError, ToolAuthUpstreamError } = await import("@/lib/tool-auth/nango-client");

    createNangoConnectSession.mockRejectedValueOnce(new ToolAuthConfigError("missing secret"));
    const configRes = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never
    );
    expect(configRes.status).toBe(503);
    expect(await configRes.json()).toMatchObject({ error: "nango_not_configured" });

    createNangoConnectSession.mockRejectedValueOnce(new ToolAuthUpstreamError("upstream down"));
    const upstreamRes = await POST(
      new Request("http://localhost/api/tools/connect/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack" }),
      }) as never
    );
    expect(upstreamRes.status).toBe(502);
    expect(await upstreamRes.json()).toMatchObject({ error: "nango_upstream_error", status: 502 });
  });

  it("builds authorizeUrl from sessionToken when connectLink is absent", async () => {
    createNangoConnectSession.mockResolvedValueOnce({
      connectLink: undefined,
      sessionToken: "session-abc",
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
    expect(body.authorizeUrl).toContain("session_token=session-abc");
    expect(body.authorizeUrl).toContain("integration_id=slack-mcp");
  });
});
