// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentOnboardingToken } from "@/lib/agent-onboarding";

const TEST_DB_DIR = path.join(os.tmpdir(), `onboarding-register-b22-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "register.db");
const HOST = "https://memroos.example.test";

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_ONBOARDING_SECRET = "onboarding-secret";
  vi.resetModules();
  const registerRoute = await import("../route");
  const dbModule = await import("@/lib/db");
  return { registerRoute, closeDb: dbModule.closeDb };
}

describe("POST /api/onboarding/register batch22", () => {
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

  it("returns 400 for non-JSON body", async () => {
    const { registerRoute } = await loadRoute();
    const res = await registerRoute.POST(
      new Request(`${HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when platform is not allowlisted", async () => {
    const { registerRoute } = await loadRoute();
    const { token } = createAgentOnboardingToken({
      memroosUrl: HOST,
      defaultPlatform: "codex",
    });
    const res = await registerRoute.POST(
      new Request(`${HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          id: `agent-b22-${crypto.randomUUID().slice(0, 8)}`,
          name: "Bad Platform",
          role: "Worker",
          platform: "not-a-platform",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("registers with tailscale location when token is valid", async () => {
    const { registerRoute } = await loadRoute();
    const agentId = `agent-b22-${crypto.randomUUID().slice(0, 8)}`;
    const { token } = createAgentOnboardingToken({
      memroosUrl: HOST,
      allowedAgentIds: [agentId],
      defaultPlatform: "codex",
    });
    const res = await registerRoute.POST(
      new Request(`${HOST}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          id: agentId,
          name: "Tailscale Agent",
          role: "Worker",
          platform: "codex",
          location: "tailscale",
          issueApiKey: false,
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.agent.location).toBe("tailscale");
  });
});
