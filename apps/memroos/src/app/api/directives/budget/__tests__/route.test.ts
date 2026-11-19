// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const { GET, POST } = await import("../route");

function makeGetRequest(query = "", headers: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/directives/budget");
  if (query) url.searchParams.set("tenant", query);
  return new NextRequest(url.toString(), { method: "GET", headers });
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/directives/budget", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("/api/directives/budget", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue(null);
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns 401 without credentials", async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("GET succeeds for admin session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "a1",
      role: "admin",
      email: "admin@example.com",
    });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enforcement).toBe("warn_only");
    expect(body.config).toHaveProperty("budgetLines");
  });

  it("GET succeeds with operator API key bearer", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "op-key-test";
    const res = await GET(makeGetRequest("", { authorization: "Bearer op-key-test" }));
    expect(res.status).toBe(200);
  });

  it("POST returns 400 for invalid json", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({ userId: "a1", role: "admin" });
    const req = new NextRequest("http://localhost/api/directives/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST evaluates directive_text budget", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({ userId: "a1", role: "admin" });
    const res = await POST(
      makePostRequest({ directive_text: "line one\nline two\n" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.lineCount).toBe(2);
    expect(body.report.status).toBe("ok");
  });

  it("POST requires tenant_id when setting budget_lines", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({ userId: "a1", role: "admin" });
    const res = await POST(makePostRequest({ budget_lines: 500 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("tenant_id");
  });
});
