// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch22b — admin gate and viewer role floor", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch22b-min32chars";
  }

  it("rejects reviewer JWT on operator-only POST /api/evals/run", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b22b", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/evals/run", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("rejects reviewer JWT on operator-only POST /api/l3/poll", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-b22b", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/l3/poll", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("redirects legacy memroos.dev host to canonical marketing domain", async () => {
    const res = await proxy(new NextRequest("http://memroos.dev/platform", { headers: { host: "memroos.dev" } }));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://memroos.com/");
  });
});
