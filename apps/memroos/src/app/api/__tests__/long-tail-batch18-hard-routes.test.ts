// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const LOOPBACK = "http://localhost";

describe("long-tail batch18 — directives budget & tools disconnect (hard gaps)", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateUser.mockResolvedValue(null);
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
    vi.resetModules();
  });

  it("GET /api/directives/budget accepts MEMROOS_AGENT_API_KEY bearer", async () => {
    const agentKey = `agent-${randomUUID()}`;
    process.env.MEMROOS_AGENT_API_KEY = agentKey;
    const { GET } = await import("../directives/budget/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/budget?tenant=default-tenant`, {
        headers: { authorization: `Bearer ${agentKey}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config).toBeDefined();
  });

  it("GET /api/directives/budget rejects bearer with wrong length (safeEqual)", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "short-key";
    const { GET } = await import("../directives/budget/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        headers: { authorization: "Bearer much-longer-wrong-key" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/directives/budget returns validation failed for empty object", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../directives/budget/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/validation failed/i);
  });

  it("POST /api/directives/budget sets tenant budget_lines without directive_text", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const tenantId = `tenant-${randomUUID().slice(0, 8)}`;
    const { POST } = await import("../directives/budget/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, budget_lines: 42 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enforcement).toBe("warn_only");
    expect(body.config).toBeDefined();
    expect(body.report).toBeUndefined();
  });
});
