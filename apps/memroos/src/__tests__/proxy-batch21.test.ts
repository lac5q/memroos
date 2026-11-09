// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch21", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch21-min32chars";
  }

  it("rejects reviewer JWT on operator-only POST /api/evals/run", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-batch21", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/evals/run", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("forwards authenticated API requests with user headers when role is sufficient", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-batch21", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/model-routing/recommendations", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
