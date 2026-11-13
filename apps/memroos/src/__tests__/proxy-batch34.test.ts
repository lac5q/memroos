// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch34", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch34-min32chars!!";
  }

  it.skip("blocks operator JWT on POST /api/auth/invite (ADMIN_ROUTES 202-203) — proxy returns NextResponse.next(); 403 is enforced in route handler", () => {});

  it.skip("reviewer floor denial (217) — no UserRole ranks below reviewer in ROLE_RANK", () => {});

  it("allows admin JWT through POST /api/auth/invite", async () => {
    setJwtSecret();
    const token = await signAccessToken(`admin-b34-${randomUUID().slice(0, 8)}`, "admin");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/auth/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
