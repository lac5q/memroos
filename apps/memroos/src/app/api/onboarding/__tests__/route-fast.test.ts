// @vitest-environment node
/**
 * Fast smoke coverage for onboarding HTTP routes (excluded from the slow gate).
 * Full integration paths (bash script execution, all platforms) stay in route.test.ts.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentOnboardingToken } from "@/lib/agent-onboarding";

const TEST_DB_DIR = path.join(os.tmpdir(), `onboarding-fast-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "routes-fast.db");

async function loadRoutes() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";
  process.env.MEMROOS_ONBOARDING_SECRET = "onboarding-secret";
  vi.resetModules();
  const inviteRoute = await import("../invite/route");
  const registerRoute = await import("../register/route");
  const scriptRoute = await import("../script/route");
  const dbModule = await import("@/lib/db");
  return { inviteRoute, registerRoute, scriptRoute, closeDb: dbModule.closeDb };
}

describe("onboarding routes (fast smoke)", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoutes();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_ONBOARDING_SECRET;
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/agent-onboarding");
  });

  it("invite POST returns 403 without operator authorization", async () => {
    const { inviteRoute } = await loadRoutes();
    const res = await inviteRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "codex" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("invite POST mints token and command with operator key", async () => {
    const { inviteRoute } = await loadRoutes();
    const res = await inviteRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret",
        },
        body: JSON.stringify({
          agentId: "fast-agent",
          name: "Fast Agent",
          platform: "codex",
          ttlMinutes: 5,
          capabilities: [
            { id: "search", name: "Search", description: "Find things", tags: ["read"] },
            { id: "", name: "Skipped" },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.command).toContain("/api/onboarding/script?token=");
    expect(body.command).toContain("--id 'fast-agent'");
  });

  it("invite POST returns 500 when token minting throws", async () => {
    vi.doMock("@/lib/agent-onboarding", async () => {
      const actual = await vi.importActual<typeof import("@/lib/agent-onboarding")>(
        "@/lib/agent-onboarding"
      );
      return {
        ...actual,
        createAgentOnboardingToken: () => {
          throw new Error("mint failed");
        },
      };
    });
    const { inviteRoute } = await loadRoutes();
    const res = await inviteRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret",
        },
        body: JSON.stringify({ platform: "codex" }),
      })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "mint failed" });
  });

  it("register POST rejects malformed bodies with 400", async () => {
    const { registerRoute } = await loadRoutes();
    const res = await registerRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "t", id: "a" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Invalid onboarding registration body" });
  });

  it("register POST rejects invalid tokens with 403", async () => {
    const { registerRoute } = await loadRoutes();
    const res = await registerRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "not-a-valid-token",
          id: "agent",
          name: "Agent",
          role: "Worker",
          platform: "codex",
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("register POST rejects agent id outside scoped invite", async () => {
    const { registerRoute } = await loadRoutes();
    const { token } = createAgentOnboardingToken({
      memroosUrl: "https://memroos.example.test",
      allowedAgentIds: ["scoped-only"],
      defaultPlatform: "codex",
    });
    const res = await registerRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          id: "other-agent",
          name: "Other",
          role: "Worker",
          platform: "codex",
          issueApiKey: false,
        }),
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "Onboarding token is not valid for this agent id",
    });
  });

  it("register POST succeeds without issuing API keys (fast path)", async () => {
    const { inviteRoute, registerRoute } = await loadRoutes();
    const inviteRes = await inviteRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret",
        },
        body: JSON.stringify({
          agentId: "fast-register",
          name: "Fast Register",
          role: "Smoke",
          platform: "codex",
        }),
      })
    );
    const invite = await inviteRes.json();

    const registerRes = await registerRoute.POST(
      new Request("https://memroos.example.test/api/onboarding/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: invite.token,
          id: "fast-register",
          name: "Fast Register",
          role: "Smoke",
          platform: "codex",
          issueApiKey: false,
        }),
      })
    );
    expect(registerRes.status).toBe(200);
    const body = await registerRes.json();
    expect(body.ok).toBe(true);
    expect(body.agent.id).toBe("fast-register");
    expect(body.mcp.mcpServers.memroos.url).toContain("/mcp");
    expect(body.apiKey).toBeUndefined();
  });

  it("script GET rejects bad tokens and serves shell for valid tokens", async () => {
    const { scriptRoute } = await loadRoutes();
    const { token } = createAgentOnboardingToken({
      memroosUrl: "https://memroos.example.test",
      defaultPlatform: "codex",
    });

    const bad = await scriptRoute.GET(
      new Request("https://memroos.example.test/api/onboarding/script?token=bad")
    );
    expect(bad.status).toBe(403);

    const ok = await scriptRoute.GET(
      new Request(`https://memroos.example.test/api/onboarding/script?token=${encodeURIComponent(token)}`)
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/x-shellscript");
    const script = await ok.text();
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain(token);
    expect(script).toContain("https://memroos.example.test");
    expect(script).toContain("/api/onboarding/register");
  });
});
