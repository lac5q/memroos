// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch24 — role gates", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch24-min32chars";
  }

  it("passes through POST /api/auth/invite before admin rank check (admin gate lines not reachable on this path)", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-b24", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/auth/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(403);
  });

  it("rejects reviewer JWT on operator-only POST /api/evals/run", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b24", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/evals/run", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });
});
