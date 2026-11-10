// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch13b", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-trust-boundary";
  }

  it("allows operator JWT access to POST /api/onboarding/invite", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-user", "operator");
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("blocks reviewer JWT from operator-only POST /api/seal/proposals", async () => {
    setJwtSecret();
    const reviewer = await signAccessToken("reviewer-user", "reviewer");
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/seal/proposals", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: `Bearer ${reviewer}` },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "insufficient permissions" });
  });

  it("passes through register UI without a session cookie", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/register?token=abc", {
        headers: { host: "localhost:3002" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("treats preview.vercel.app hosts as public marketing hosts", async () => {
    const response = await proxy(
      new NextRequest("https://memroos-git-main-lac5q.vercel.app/blog/post", {
        headers: { host: "memroos-git-main-lac5q.vercel.app" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets POST /api/audit/knowledge use route-local auth", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/audit/knowledge", {
        method: "POST",
        headers: { host: "localhost:3002" },
      }),
    );
    expect(response.status).toBe(200);
  });
});
