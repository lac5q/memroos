// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentOnboardingToken } from "@/lib/agent-onboarding";

const TEST_DB_DIR = path.join(os.tmpdir(), `onboarding-register-b34b-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "register.db");
const HOST = "http://localhost";

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_ONBOARDING_SECRET = "onboarding-secret-b34b";
  vi.resetModules();
  const registerRoute = await import("../route");
  const dbModule = await import("@/lib/db");
  return { registerRoute, closeDb: dbModule.closeDb };
}

describe("POST /api/onboarding/register batch34b", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_ONBOARDING_SECRET;
  });

  it("defaults invalid protocol strings to rest and copies optional registration fields", async () => {
    const { registerRoute } = await loadRoute();
    const agentId = `agent-b34b-${randomUUID().slice(0, 8)}`;
    const { token } = createAgentOnboardingToken({
      memroosUrl: HOST,
      defaultPlatform: "qwen",
      defaultProtocol: "ui",
      capabilities: [{ id: "onboard-cap", name: "Onboard", description: "", tags: [] }],
    });
    const res = await registerRoute.POST(
      new Request(`${HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          id: agentId,
          name: "Onboarded Agent",
          role: "Worker",
          platform: "qwen",
          protocol: "not-listed",
          company: "Batch34b Co",
          location: "local",
          host: "10.0.0.5",
          port: 9191,
          healthEndpoint: "/ready",
          tunnelUrl: "http://localhost/agent",
          metadata: { onboardTag: "b34b" },
          issueApiKey: false,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.protocol).toBe("rest");
    expect(body.agent).toMatchObject({
      company: "Batch34b Co",
      location: "local",
      host: "10.0.0.5",
      port: 9191,
      healthEndpoint: "/ready",
      tunnelUrl: "http://localhost/agent",
    });
    expect(body.agent.capabilities).toEqual([
      expect.objectContaining({ id: "onboard-cap" }),
    ]);
    expect(body.agent.metadata.onboardedVia).toBe("memroos");
  });

  it("returns 403 when token allowedAgentIds excludes the requested agent", async () => {
    const { registerRoute } = await loadRoute();
    const allowed = `allowed-b34b-${randomUUID().slice(0, 6)}`;
    const blocked = `blocked-b34b-${randomUUID().slice(0, 6)}`;
    const { token } = createAgentOnboardingToken({
      memroosUrl: HOST,
      allowedAgentIds: [allowed],
    });
    const res = await registerRoute.POST(
      new Request(`${HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          id: blocked,
          name: "Blocked",
          role: "Worker",
          platform: "codex",
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not valid for this agent id/i);
  });

  it("treats non-object metadata as empty during parse", async () => {
    const { registerRoute } = await loadRoute();
    const agentId = `agent-meta-b34b-${randomUUID().slice(0, 8)}`;
    const { token } = createAgentOnboardingToken({ memroosUrl: HOST });
    const res = await registerRoute.POST(
      new Request(`${HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          id: agentId,
          name: "Meta",
          role: "Worker",
          platform: "codex",
          metadata: null,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.metadata.onboardedVia).toBe("memroos");
    expect(body.agent.metadata.onboardTag).toBeUndefined();
  });
});
