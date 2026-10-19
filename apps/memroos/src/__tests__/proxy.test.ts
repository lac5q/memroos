// @vitest-environment node
import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as nextServerTesting from "next/experimental/testing/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { config, proxy } from "../proxy";

const doesProxyMatch =
  (
    nextServerTesting as typeof nextServerTesting & {
      unstable_doesProxyMatch?: typeof nextServerTesting.unstable_doesMiddlewareMatch;
    }
  ).unstable_doesProxyMatch ?? nextServerTesting.unstable_doesMiddlewareMatch;

describe("proxy", () => {
  afterEach(() => {
    delete process.env.MEMROOS_JWT_SECRET;
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  function setJwtSecret() {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-proxy-trust-boundary";
  }

  async function expiredAccessToken(userId: string, role: string): Promise<string> {
    setJwtSecret();
    return new SignJWT({ role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env.MEMROOS_JWT_SECRET));
  }

  it("keeps matcher coverage on API and app routes while excluding static assets", () => {
    expect(doesProxyMatch({ config, nextConfig: {}, url: "/api/memory/add" })).toBe(true);
    expect(doesProxyMatch({ config, nextConfig: {}, url: "/dispatch" })).toBe(true);
    expect(doesProxyMatch({ config, nextConfig: {}, url: "/_next/static/chunk.js" })).toBe(false);
    expect(doesProxyMatch({ config, nextConfig: {}, url: "/_next/image" })).toBe(false);
    expect(doesProxyMatch({ config, nextConfig: {}, url: "/favicon.ico" })).toBe(false);
    expect(doesProxyMatch({ config, nextConfig: {}, url: "/icon.svg" })).toBe(false);
  });

  it("does not hard-code private hosts for HTTPS redirects", async () => {
    const response = await proxy(
      new NextRequest("http://app.memroos.test/login", {
        headers: { host: "app.memroos.test" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects the production app host from HTTP to HTTPS", async () => {
    process.env.MEMROOS_HTTPS_APP_HOSTS = "app.memroos.test";
    const response = await proxy(
      new NextRequest("http://app.memroos.test/login", {
        headers: { host: "app.memroos.test" },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.memroos.test/login");
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  it("requires authentication for protected API routes without a token", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication required" });
  });

  it("keeps cron-health behind session authentication", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/cron-health", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication required" });
  });

  it("lets runtime health respond without a session token", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/health", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets agent onboarding bootstrap routes handle their own signed-token authorization", async () => {
    const scriptResponse = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/script?token=signed-token", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );
    const registerResponse = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/register", {
        method: "POST",
        headers: { host: "localhost:3002", "content-type": "application/json" },
      })
    );

    expect(scriptResponse.status).toBe(200);
    expect(await scriptResponse.text()).toBe("");
    expect(registerResponse.status).toBe(200);
    expect(await registerResponse.text()).toBe("");
  });

  it("rejects expired or malformed JWT credentials on protected API routes", async () => {
    const expired = await expiredAccessToken("reviewer-expired", "reviewer");
    const expiredResponse = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: `Bearer ${expired}` },
      })
    );

    const malformedResponse = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: "Bearer not.a.jwt" },
      })
    );

    expect(expiredResponse.status).toBe(401);
    expect(await expiredResponse.json()).toEqual({ error: "authentication required" });
    expect(malformedResponse.status).toBe(401);
    expect(await malformedResponse.json()).toEqual({ error: "authentication required" });
  });

  it("rejects reviewer role escalation on operator API routes", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-user", "reviewer");
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "insufficient permissions" });
  });

  it("does not let route-local auth path traversal bypass protected API auth", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/memory/add/%2e%2e/%2e%2e/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: "Bearer agent-key" },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication required" });
  });

  it("Bearer token takes precedence over access_token cookies for API authorization", async () => {
    setJwtSecret();
    const reviewerToken = await signAccessToken("reviewer-user", "reviewer");
    const operatorToken = await signAccessToken("operator-user", "operator");
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/onboarding/invite", {
        method: "POST",
        headers: {
          host: "localhost:3002",
          authorization: `Bearer ${reviewerToken}`,
          cookie: `access_token=${operatorToken}`,
        },
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "insufficient permissions" });
  });

  it("lets agent-authenticated API routes handle their own authorization", async () => {
    const addResponse = await proxy(
      new NextRequest("http://localhost:3002/api/memory/add", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: "Bearer agent-key" },
      })
    );
    const healthResponse = await proxy(
      new NextRequest("http://localhost:3002/api/memory/health", {
        method: "GET",
        headers: { host: "localhost:3002", authorization: "Bearer agent-key" },
      })
    );

    expect(addResponse.status).toBe(200);
    expect(await addResponse.text()).toBe("");
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.text()).toBe("");
  });

  it("lets the agent context packet route handle its own agent-key authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/agent-context?goal_id=phase-132", {
        method: "GET",
        headers: { host: "localhost:3002", authorization: "Bearer agent-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets GSD command routes handle their own agent-key authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/gsd/shipcheck", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: "Bearer agent-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets local memory search handle its own authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/memory/search?q=omnisend", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets operator-key API routes handle their own authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/agents/register", {
        method: "POST",
        headers: { host: "localhost:3002", "x-memroos-operator-key": "operator-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets telemetry shipment handle its own operator-key authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/operations/telemetry", {
        method: "POST",
        headers: { host: "localhost:3002", "x-memroos-operator-key": "operator-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets recall ingest handle its own operator-key authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/recall/ingest", {
        method: "POST",
        headers: { host: "localhost:3002", "x-memroos-operator-key": "operator-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets recall search handle its own memory policy gate", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/recall?q=mkt-hub", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets connector-search handle its own loopback authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/internal/connector-search?q=Alacriti", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets SkillForge routes handle their own local/operator authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/skillforge/status", {
        method: "GET",
        headers: { host: "localhost:3002", "x-memroos-operator-key": "operator-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets agent-memory continuity routes handle their own local/operator authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/agent-memory/capture", {
        method: "POST",
        headers: { host: "localhost:3002", "x-memroos-operator-key": "operator-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets agent-context bus routes handle their own agent-key authorization", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/agent-context/messages", {
        method: "POST",
        headers: { host: "localhost:3002", authorization: "Bearer agent-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("lets ChatGPT Action routes handle their own API key authorization", async () => {
    const response = await proxy(
      new NextRequest("https://app.memroos.test/api/chatgpt/actions/search", {
        method: "POST",
        headers: { host: "app.memroos.test", "x-api-key": "action-key" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("serves research PDFs on the public marketing host", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/research/memroos-governed-knowledge-architecture-paper.pdf", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves public screenshot assets on the marketing host", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/screenshots/memroos-floor.png", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves extracted landing assets on the marketing host", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/landing/assets/shots/operator-floor.png", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves the SVG app icon on the marketing host", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/icon.svg", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves the unlinked Understand graph page on the marketing host with noindex headers", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/understand?token=graph-token", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("serves Understand dashboard static assets with same-origin frame protection", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/understand-static/index.html?token=graph-token", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  it("lets the Understand graph JSON route handle token authorization on the marketing host", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/knowledge-graph.json?token=graph-token", {
        headers: { host: "memroos.com" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("requires app-host session auth for the Understand page", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.example.com/understand?token=graph-token", {
        headers: { host: "memroos.example.com" },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://memroos.example.com/login");
  });

  it("requires app-host session auth before Understand JSON token authorization", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.example.com/knowledge-graph.json?token=graph-token", {
        headers: { host: "memroos.example.com" },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://memroos.example.com/login");
  });

  it("treats a custom domain as an app host", async () => {
    const loginResponse = await proxy(
      new NextRequest("https://memroos.example.com/login", {
        headers: { host: "memroos.example.com" },
      })
    );

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("location")).toBeNull();

    const appResponse = await proxy(
      new NextRequest("https://memroos.example.com/dispatch", {
        headers: { host: "memroos.example.com" },
      })
    );

    expect(appResponse.status).toBe(307);
    expect(appResponse.headers.get("location")).toBe("https://memroos.example.com/login");
  });

  it("serves the public landing on memroos.localhost for local preview", async () => {
    const response = await proxy(
      new NextRequest("http://memroos.localhost:3003/", {
        headers: { host: "memroos.localhost:3003" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://memroos.localhost:3003/landing/index.html"
    );
  });

  it("redirects www public traffic to the canonical apex host", async () => {
    const response = await proxy(
      new NextRequest("https://www.memroos.com/blog?ref=gsc", {
        headers: { host: "www.memroos.com" },
      })
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://memroos.com/blog?ref=gsc");
  });

  it("allows analytics and Google Fonts endpoints in the content security policy", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/", {
        headers: { host: "memroos.com" },
      })
    );

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toContain("https://www.googletagmanager.com");
    expect(csp).toContain("https://www.google-analytics.com");
    expect(csp).toContain("https://region1.google-analytics.com");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
  });

  it("redirects legacy memroos.dev hosts to the canonical marketing domain", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.dev/pricing", {
        headers: { host: "memroos.dev" },
      })
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://memroos.com/");
  });

  it("redirects unauthenticated UI routes to login", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.example.com/agents", {
        headers: { host: "memroos.example.com" },
      })
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://memroos.example.com/login");
  });

  it("redirects configured app hosts when x-forwarded-proto is http", async () => {
    process.env.MEMROOS_HTTPS_APP_HOSTS = "secure.memroos.test";
    const response = await proxy(
      new NextRequest("https://secure.memroos.test/dispatch", {
        headers: { host: "secure.memroos.test", "x-forwarded-proto": "http" },
      })
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://secure.memroos.test/dispatch");
    delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  });

  it("redirects non-landing marketing paths back to home", async () => {
    const response = await proxy(
      new NextRequest("https://memroos.com/private-console", {
        headers: { host: "memroos.com" },
      })
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://memroos.com/");
  });

  it("lets the public tools provider catalog respond without a session token", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/tools/providers", {
        method: "GET",
        headers: { host: "localhost:3002" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("allows reviewer JWT access to protected API routes that are not operator-only", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-user", "reviewer");
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/cron-health", {
        method: "GET",
        headers: { host: "localhost:3002", authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("accepts session cookies for protected API routes when Authorization is absent", async () => {
    setJwtSecret();
    const token = await signAccessToken("reviewer-user", "reviewer");
    const response = await proxy(
      new NextRequest("http://localhost:3002/api/cron-health", {
        method: "GET",
        headers: { host: "localhost:3002", cookie: `access_token=${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("serves authenticated UI routes when a valid access_token cookie is present", async () => {
    setJwtSecret();
    const token = await signAccessToken("operator-user", "operator");
    const response = await proxy(
      new NextRequest("https://memroos.example.com/dispatch", {
        headers: { host: "memroos.example.com", cookie: `access_token=${token}` },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects UI routes to login when the access_token cookie is invalid", async () => {
    setJwtSecret();
    const expired = await expiredAccessToken("operator-user", "operator");
    const response = await proxy(
      new NextRequest("https://memroos.example.com/dispatch", {
        headers: { host: "memroos.example.com", cookie: `access_token=${expired}` },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://memroos.example.com/login");
  });

  it("includes unsafe-eval in CSP when NODE_ENV is not production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const response = await proxy(
        new NextRequest("https://memroos.com/", {
          headers: { host: "memroos.com" },
        })
      );
      expect(response.headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
