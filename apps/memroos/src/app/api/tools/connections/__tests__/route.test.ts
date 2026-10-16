// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const authenticateUser = vi.hoisted(() => vi.fn());
const listNangoConnections = vi.hoisted(() => vi.fn());
const ToolAuthConfigError = vi.hoisted(
  () =>
    class ToolAuthConfigError extends Error {
      name = "ToolAuthConfigError";
    }
);
const ToolAuthUpstreamError = vi.hoisted(
  () =>
    class ToolAuthUpstreamError extends Error {
      name = "ToolAuthUpstreamError";
      status = 502;
      constructor(message: string) {
        super(message);
      }
    }
);

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  listVaultConnections: vi.fn(() => [{ providerKey: "slack", authMode: "oauth" as const }]),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoConnections: (...args: unknown[]) => listNangoConnections(...args),
  ToolAuthConfigError,
  ToolAuthUpstreamError,
}));

const { GET } = await import("../route");

describe("GET /api/tools/connections", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    listNangoConnections.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/tools/connections") as never);
    expect(res.status).toBe(401);
  });

  it("returns vault-only when nango not configured", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    listNangoConnections.mockRejectedValueOnce(new ToolAuthConfigError("missing"));
    const res = await GET(new Request("http://localhost/api/tools/connections") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toHaveLength(1);
  });

  it("merges nango connections when available", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    listNangoConnections.mockResolvedValueOnce([{ providerKey: "github", authMode: "oauth" }]);
    const res = await GET(new Request("http://localhost/api/tools/connections") as never);
    const body = await res.json();
    expect(body.connections.some((c: { providerKey: string }) => c.providerKey === "github")).toBe(true);
  });

  it("returns warnings on upstream error", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    listNangoConnections.mockRejectedValueOnce(new ToolAuthUpstreamError("upstream down"));
    const res = await GET(new Request("http://localhost/api/tools/connections") as never);
    const body = await res.json();
    expect(body.warnings?.[0]?.source).toBe("nango");
  });
});
