// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const storeApiKeyConnection = vi.hoisted(() =>
  vi.fn(async () => ({ connectionId: "conn-test", providerKey: "demo-api" }))
);

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/providers", () => ({
  getProvider: vi.fn((key: string) =>
    key === "demo-api"
      ? {
          key: "demo-api",
          label: "Demo",
          authMode: "api-key",
          apiKeyField: "API Key",
          docsUrl: "https://example.com/docs",
        }
      : null
  ),
  isApiKeyProvider: (p: { authMode: string }) => p?.authMode === "api-key",
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  storeApiKeyConnection: (...args: unknown[]) => storeApiKeyConnection(...args),
  appendActivityEvent: vi.fn(),
}));

const { POST } = await import("../route");

describe("POST /api/tools/connect/api-key", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/tools/connect/api-key", {
        method: "POST",
        body: JSON.stringify({ providerKey: "demo-api", credentials: { apiKey: "12345678" } }),
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
      new Request("http://localhost/api/tools/connect/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "missing", credentials: { apiKey: "12345678" } }),
      }) as never
    );
    expect(res.status).toBe(404);
  });

  it("stores api key connection", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/tools/connect/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "demo-api", credentials: { apiKey: "1234567890" } }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(storeApiKeyConnection).toHaveBeenCalled();
  });
});
