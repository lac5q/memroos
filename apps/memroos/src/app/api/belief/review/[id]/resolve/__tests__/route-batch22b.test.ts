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
    userId: "operator-batch22b",
    role: "operator",
    tenantId: "default-tenant",
  });
  mockRequireRole.mockReturnValue(null);
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/belief/review/[id]/resolve batch22b", () => {
  it("returns 400 for invalid JSON and resolution values", async () => {
    const { POST } = await import("../route");

    const invalidJson = await POST(
      new Request(`${LOOPBACK}/api/belief/review/q1/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }) as never,
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(invalidJson.status).toBe(400);
    expect((await invalidJson.json()).error).toMatch(/invalid json/i);

    const badResolution = await POST(
      new Request(`${LOOPBACK}/api/belief/review/q1/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "maybe" }),
      }) as never,
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(badResolution.status).toBe(400);
    expect((await badResolution.json()).error).toMatch(/approved or rejected/i);
  });

  it("maps resolveReview errors to 404 and 409 status codes", async () => {
    const { POST } = await import("../route");

    mockResolveReview.mockImplementationOnce(() => {
      throw new Error("queue item not found");
    });
    const notFound = await POST(
      new Request(`${LOOPBACK}/api/belief/review/missing/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "rejected" }),
      }) as never,
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(notFound.status).toBe(404);

    mockResolveReview.mockImplementationOnce(() => {
      throw new Error("item already resolved");
    });
    const conflict = await POST(
      new Request(`${LOOPBACK}/api/belief/review/resolved/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "approved" }),
      }) as never,
      { params: Promise.resolve({ id: "resolved" }) },
    );
    expect(conflict.status).toBe(409);
  });

  it("returns admission payload on approved resolution", async () => {
    mockResolveReview.mockReturnValueOnce({
      resolution: "approved",
      decisionId: "dec-batch22b",
      admission: {
        kind: "queued_for_review",
        decisionId: "dec-batch22b",
        queueId: "q-next",
        receipt: { id: "rcpt-batch22b" },
      },
      receipt: { id: "rcpt-batch22b" },
    });
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/belief/review/q-approved/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "approved", note: "batch22b ok", category: "ops" }),
      }) as never,
      { params: Promise.resolve({ id: "q-approved" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolution).toBe("approved");
    expect(body.admission?.queueId).toBe("q-next");
    expect(body.admission?.receipt).toEqual({ id: "rcpt-batch22b" });
  });
});
