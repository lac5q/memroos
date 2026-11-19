// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch20", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch20-min32chars";
  }

  it("rejects reviewer JWT on operator-only POST /api/l3/poll", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-batch20", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/l3/poll", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("rejects reviewer JWT on operator-only PUT /api/evals/config", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-batch20", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/evals/config", {
        method: "PUT",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("omits unsafe-eval from CSP when NODE_ENV is production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await proxy(
        new NextRequest("https://memroos.com/", {
          headers: { host: "memroos.com" },
        }),
      );
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain("https://www.googletagmanager.com");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("redirects app UI when access_token cookie is missing", async () => {
    const res = await proxy(
      new NextRequest("https://memroos.example.com/settings", {
        headers: { host: "memroos.example.com" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://memroos.example.com/login");
  });
});
