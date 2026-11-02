// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch26 — host normalize, operator gate, auth passthrough", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch26-min32chars";
  }

  it("normalizes missing host header without throwing (normalizeHost branch line 19)", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/health", {
        headers: {},
      }),
    );
    expect(res.status).toBe(200);
  });

  it("passes through POST /api/auth/invite before admin RBAC (lines 202-203 unreachable behind passthrough)", async () => {
    setJwtSecret();
    const reviewer = await signAccessToken("reviewer-b26", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/auth/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${reviewer}` },
      }),
    );
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("rejects reviewer JWT on operator-only POST /api/onboarding/invite (operator gate lines 208-211)", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b26-op", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("forwards operator JWT with identity headers on protected API routes", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-b26", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
