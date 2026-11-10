// @vitest-environment node
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const { GET } = await import("../route");

function makeDiffRequest(body: unknown | null, init: { headers?: HeadersInit } = {}): NextRequest {
  const nextUrl = new URL("http://localhost/api/directives/diff");
  return {
    nextUrl,
    headers: new Headers(init.headers),
    json: async () => {
      if (body === null) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

describe("GET /api/directives/diff", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "a1",
      role: "admin",
      email: "admin@example.com",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when body is missing", async () => {
    const res = await GET(makeDiffRequest(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("JSON body required");
  });

  it("returns diff for differing local and canonical texts", async () => {
    const res = await GET(
      makeDiffRequest({ local: "alpha\nbeta\n", canonical: "alpha\ngamma\n" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.diff.identical).toBe(false);
    expect(body.message).toContain("drift");
  });

  it("returns 401 when session is missing and no bearer key is provided", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const res = await GET(
      makeDiffRequest({ local: "a", canonical: "b" })
    );
    expect(res.status).toBe(401);
  });

  it("authorizes operator api keys for diff requests", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";
    const nextUrl = new URL("http://localhost/api/directives/diff");
    const res = await GET({
      nextUrl,
      headers: new Headers({ authorization: "Bearer operator-secret" }),
      json: async () => ({ local: "a\n", canonical: "a\n" }),
    } as unknown as NextRequest);
    expect(res.status).toBe(200);
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  it("returns validation errors for oversized directive payloads", async () => {
    const res = await GET(makeDiffRequest({ local: "x".repeat(3_000_000), canonical: "y" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation failed");
  });

  it("reports identical texts", async () => {
    const text = "same\ncontent\n";
    const res = await GET(makeDiffRequest({ local: text, canonical: text }));
    const body = await res.json();
    expect(body.diff.identical).toBe(true);
    expect(body.message).toContain("matches canonical");
  });
});
