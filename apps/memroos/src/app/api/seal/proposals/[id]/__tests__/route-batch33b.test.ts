// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(async () => null),
}));

describe("/api/seal/proposals/[id] batch33b", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  afterEach(() => {
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  it("POST requires registry write when x-user-id is absent (line 32)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://memroos.example/api/seal/proposals/proposal-b33b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", operator: "agent-b33b" }),
      }) as never,
      { params: Promise.resolve({ id: "proposal-b33b" }) },
    );
    expect(res.status).toBe(403);
  });

  it("POST rejects invalid JSON before action validation (line 36)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/seal/proposals/proposal-b33b", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": "operator-b33b" },
        body: "not-json",
      }) as never,
      { params: Promise.resolve({ id: "proposal-b33b" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/action must be approve/);
  });
});
