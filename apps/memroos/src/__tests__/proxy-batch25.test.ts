// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { proxy } from "../proxy";

describe("proxy batch25 — host normalize, UI auth skip, role floor", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
    vi.restoreAllMocks();
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-batch25-min32chars";
  }

  it("strips port from host header before HTTPS redirect checks", async () => {
    process.env.MEMROOS_HTTPS_APP_HOSTS = "app.example.com";
    const res = await proxy(
      new NextRequest("http://app.example.com:8080/settings", {
        headers: { host: "app.example.com:8080", "x-forwarded-proto": "http" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.com/settings");
  });

  it("passes through /_next assets without requiring access_token cookie", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/_next/static/chunk-batch25.js", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("forwards operator JWT with x-user-id and x-user-role on protected API routes", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-b25", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/users/me", {
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("redirects app UI to login when access_token cookie is absent", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/settings", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
