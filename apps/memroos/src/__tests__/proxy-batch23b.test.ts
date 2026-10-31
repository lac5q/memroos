// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch23b — operator gate and pass-through", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch23b-min32chars";
  }

  it("rejects reviewer JWT on operator-only POST /api/l3/poll", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b23b", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/l3/poll", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("forwards operator JWT on standard authenticated GET /api/users/me", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-b23b", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
