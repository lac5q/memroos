// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateUser = vi.fn();
const mockRequireRole = vi.fn();
const mockResolveReview = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})) }));

vi.mock("@/lib/belief/promotion", () => ({
  resolveReview: (...args: unknown[]) => mockResolveReview(...args),
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockRequireRole.mockReset();
  mockResolveReview.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "operator-b33",
    role: "reviewer",
    tenantId: "default-tenant",
  });
  mockRequireRole.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/belief/review/[id]/resolve batch33", () => {
  it("returns role error response when requireRole fails (L29)", async () => {
    const forbidden = Response.json({ error: "insufficient permissions" }, { status: 403 });
    mockRequireRole.mockReturnValueOnce(forbidden);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/belief/review/q-b33/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "approved" }),
      }) as never,
      { params: Promise.resolve({ id: "q-b33" }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when queue id param is empty (L32)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/belief/review//resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "rejected" }),
      }) as never,
      { params: Promise.resolve({ id: "" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/queue id is required/i);
  });
});
