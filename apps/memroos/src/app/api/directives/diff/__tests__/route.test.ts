// @vitest-environment node
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const { GET } = await import("../route");

function makeDiffRequest(body: unknown | null): NextRequest {
  const nextUrl = new URL("http://localhost/api/directives/diff");
  return {
    nextUrl,
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

  it("reports identical texts", async () => {
    const text = "same\ncontent\n";
    const res = await GET(makeDiffRequest({ local: text, canonical: text }));
    const body = await res.json();
    expect(body.diff.identical).toBe(true);
    expect(body.message).toContain("matches canonical");
  });
});
