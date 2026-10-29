// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch20b", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  it("redirects legacy memroos.dev host to canonical marketing domain", async () => {
    const res = await proxy(
      new NextRequest("http://memroos.dev/blog/post", {
        headers: { host: "memroos.dev" },
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://memroos.com/");
  });

  it("passes through /api/health without authentication", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/health", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("passes through route-local auth endpoints such as /api/gsd/resume", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/gsd/resume", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).not.toBe(401);
  });

  it("redirects http app host to https when MEMROOS_HTTPS_APP_HOSTS matches", async () => {
    process.env.MEMROOS_HTTPS_APP_HOSTS = "app.example.com";
    const res = await proxy(
      new NextRequest("http://app.example.com/settings", {
        headers: { host: "app.example.com", "x-forwarded-proto": "http" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/^https:\/\/app\.example\.com\//);
  });

  it("rejects unauthenticated API calls that require JWT", async () => {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch20b-min32chars";
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "authentication required" });
  });

  it("allows reviewer JWT on non-operator GET /api/users/me when route exists in chain", async () => {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch20b-min32chars";
    const token = await signAccessToken("reviewer-batch20b", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/tools/providers", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
