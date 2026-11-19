// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUserDisconnect = vi.hoisted(() => vi.fn());
const deleteVaultConnection = vi.hoisted(() => vi.fn(() => true));
const appendActivityEvent = vi.hoisted(() => vi.fn());
const deleteNangoConnection = vi.hoisted(() => vi.fn());
const ToolAuthUpstreamError = vi.hoisted(
  () =>
    class ToolAuthUpstreamError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    },
);

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUserDisconnect(...args),
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  deleteVaultConnection: (...args: unknown[]) => deleteVaultConnection(...args),
  appendActivityEvent: (...args: unknown[]) => appendActivityEvent(...args),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  deleteNangoConnection: (...args: unknown[]) => deleteNangoConnection(...args),
  ToolAuthUpstreamError,
}));

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "u1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Op",
  tenantId: "default-tenant",
};

describe("long-tail batch18 — POST /api/tools/disconnect nango branch", () => {
  beforeEach(() => {
    authenticateUserDisconnect.mockReset();
    deleteVaultConnection.mockClear();
    appendActivityEvent.mockClear();
    deleteNangoConnection.mockReset();
    authenticateUserDisconnect.mockResolvedValue(operatorSession);
    vi.resetModules();
  });

  it("returns 400 when JSON body is invalid", async () => {
    const { POST } = await import("../tools/disconnect/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tools/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid JSON/i);
  });

  it("ignores Nango 404 when nangoConnectionId is provided", async () => {
    deleteNangoConnection.mockRejectedValueOnce(new ToolAuthUpstreamError("missing", 404));
    const { POST } = await import("../tools/disconnect/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tools/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack", nangoConnectionId: "conn-1" }),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).revoked).toBe(true);
  });

  it("returns 502 when Nango revoke fails with non-404 upstream error", async () => {
    deleteNangoConnection.mockRejectedValueOnce(new ToolAuthUpstreamError("upstream down", 502));
    const { POST } = await import("../tools/disconnect/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tools/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: "slack", nangoConnectionId: "conn-2" }),
      }) as never,
    );
    expect(res.status).toBe(502);
    expect(appendActivityEvent).toHaveBeenCalled();
  });
});
