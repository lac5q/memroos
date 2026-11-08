// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch31 — operator/admin RBAC on localhost", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch31-min32chars!";
  }

  it("blocks reviewer JWT on POST /api/onboarding/invite (operator gate lines 208–211)", async () => {
    setJwtSecret();
    const token = await signAccessToken(`reviewer-b31-${Date.now()}`, "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("allows operator JWT through protected GET /api/users/me (reviewer floor line 217 satisfied)", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-b31", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("passes POST /api/auth/invite without JWT (admin RBAC loop lines 202–203 behind /api/auth passthrough)", async () => {
    setJwtSecret();
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/auth/invite", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
