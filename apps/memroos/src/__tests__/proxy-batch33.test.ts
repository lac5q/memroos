// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch33", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch33-min32chars!!";
  }

  it.skip("admin invite 403 — /api/auth/invite is auth passthrough before ADMIN_ROUTES (202–203)", () => {});

  it.skip("reviewer floor denial — no UserRole ranks below reviewer (217)", () => {});

  it("blocks reviewer JWT on POST /api/onboarding/invite", async () => {
    setJwtSecret();
    const token = await signAccessToken(`reviewer-b33-${Date.now()}`, "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows reviewer JWT on GET /api/users/me", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b33-ok", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
