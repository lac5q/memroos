// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const createNangoConnectSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/tool-auth/providers", () => ({
  getProvider: (key: string) =>
    key === "slack" ? { key: "slack", providerConfigKey: "slack-mcp", authMode: "oauth" } : null,
  isOAuthProvider: () => true,
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

const operatorSession = {
  userId: "op-b32",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Op",
  tenantId: "default-tenant",
};

const { POST } = await import("../route");

async function postOauth() {
  return POST(
    new Request("http://localhost/api/tools/connect/oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerKey: "slack" }),
    }) as never,
  );
}

describe("POST /api/tools/connect/oauth batch32", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    createNangoConnectSession.mockReset();
    authenticateUser.mockResolvedValue(operatorSession);
  });

  it("refuses empty session tokens from Nango (lines 99-103)", async () => {
    createNangoConnectSession.mockResolvedValueOnce({ connectLink: undefined, sessionToken: "" });
    let thrown: unknown;
    try {
      await postOauth();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/session token/i);
  });

  it("rethrows unexpected Nango failures (line 94)", async () => {
    createNangoConnectSession.mockRejectedValueOnce(new Error("unexpected nango"));
    let thrown: unknown;
    try {
      await postOauth();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/unexpected nango/);
  });
});
