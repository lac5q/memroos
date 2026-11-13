// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch32 — protected API RBAC", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch32-min32chars!";
  }

  // sticky: ADMIN_ROUTES 202-203 is unreachable because /api/auth/* returns next() first (line 165).
  it.skip("admin invite 403 — /api/auth/invite is auth passthrough before ADMIN_ROUTES", () => {});

  // sticky: reviewer floor 217 needs ROLE_RANK below reviewer; UserRole has no such value.
  it.skip("reviewer floor denial — no UserRole ranks below reviewer", () => {});

  it("blocks reviewer JWT on operator-gated POST /api/onboarding/invite", async () => {
    setJwtSecret();
    const token = await signAccessToken(`reviewer-b32-${Date.now()}`, "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("allows reviewer JWT on GET /api/users/me", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b32-ok", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
