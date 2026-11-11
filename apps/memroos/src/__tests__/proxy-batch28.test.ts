// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

describe("proxy batch28 — marketing host, legacy redirect, auth edges", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  it("redirects legacy memroos.dev hosts to canonical marketing domain", async () => {
    const res = await proxy(
      new NextRequest("http://memroos.dev/pricing", {
        headers: { host: "memroos.dev" },
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://memroos.com/");
  });

  it("redirects www.memroos.com to apex with security headers", async () => {
    const res = await proxy(
      new NextRequest("https://www.memroos.com/blog/post", {
        headers: { host: "www.memroos.com" },
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toMatch(/^https:\/\/memroos\.com\/blog\/post/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("rewrites public landing root and redirects unknown paths on memroos.localhost", async () => {
    const root = await proxy(
      new NextRequest("http://memroos.localhost:3000/", {
        headers: { host: "memroos.localhost:3000" },
      }),
    );
    expect(root.status).toBe(200);
    expect(root.headers.get("x-middleware-rewrite")).toBe(
      "http://memroos.localhost:3000/landing/index.html",
    );

    const blocked = await proxy(
      new NextRequest("http://memroos.localhost:3000/dashboard", {
        headers: { host: "memroos.localhost:3000" },
      }),
    );
    expect(blocked.status).toBe(307);
    expect(blocked.headers.get("location")).toMatch(/\/$/);
  });

  it("returns 401 for protected API routes without credentials", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "authentication required" });
  });

  it("passes route-local auth for GET /api/memory/health without JWT", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/memory/health", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("adds understand noindex headers on app host for /understand routes", async () => {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch28-min32chars!!";
    const res = await proxy(
      new NextRequest("http://localhost:3000/understand", {
        headers: {
          host: "localhost:3000",
          cookie: "access_token=not-a-valid-jwt-batch28",
        },
      }),
    );
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/i);
  });
});
