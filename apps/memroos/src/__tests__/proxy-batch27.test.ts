// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch27 — HTTPS redirect, operator/admin gates where reachable", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch27-min32chars!!";
  }

  it("redirects configured app hosts from HTTP to HTTPS (shouldRedirectToHttps)", async () => {
    process.env.MEMROOS_HTTPS_APP_HOSTS = "app.localhost";
    const res = await proxy(
      new NextRequest("http://app.localhost:3000/api/health", {
        headers: { host: "app.localhost:3000" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/^https:\/\/app\.localhost/);
  });

  it("passes POST /api/auth/invite before JWT admin RBAC (lines 202-203 unreachable behind /api/auth passthrough)", async () => {
    setJwtSecret();
    const reviewer = await signAccessToken("reviewer-b27", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/auth/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${reviewer}` },
      }),
    );
    expect(res.status).not.toBe(403);
  });

  it("blocks reviewer JWT on operator-only POST /api/evals/run (operator gate lines 208-211)", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b27-eval", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/evals/run", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("allows operator JWT through protected routes (reviewer floor line 217 satisfied)", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-b27", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("documents reviewer-rank floor: unknown JWT roles are not ranked below reviewer (line 217 hard to hit)", async () => {
    setJwtSecret();
    const secret = new TextEncoder().encode(process.env.MEMROOS_JWT_SECRET);
    const oddRoleToken = await new SignJWT({ role: "guest" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("guest-b27")
      .setExpirationTime("2h")
      .sign(secret);
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${oddRoleToken}` },
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
