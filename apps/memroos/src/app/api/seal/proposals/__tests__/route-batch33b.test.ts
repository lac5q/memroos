// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(async () => ({
    userId: "u-b33b",
    role: "admin",
    email: "admin@example.com",
  })),
}));

describe("/api/seal/proposals batch33b", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  afterEach(() => {
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  it("POST rejects registry writes from non-loopback hosts (line 29)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://memroos.example/api/seal/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: "t", runId: "r" }),
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("POST treats malformed JSON as missing traceId/runId (line 32)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/seal/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/traceId and runId are required/);
  });
});
