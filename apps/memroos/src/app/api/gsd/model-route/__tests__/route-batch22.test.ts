// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-model-route-b22-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "model-route.db");
const LOOPBACK = "http://localhost";

async function loadRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const registry = await import("@/lib/agent-registry");
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  return { ...registry, ...route, closeDb: dbModule.closeDb };
}

function request(url: string, apiKey?: string, init: RequestInit = {}): Request {
  return new Request(url, {
    method: "POST",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

describe("POST /api/gsd/model-route batch22", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRoute();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("returns 401 when agent headers are missing on POST", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request(`${LOOPBACK}/api/gsd/model-route`, undefined, { body: "{}" }) as never);
    expect(res.status).toBe(401);
  });

  it("accepts malformed JSON body and still routes authenticated POST", async () => {
    const { POST, registerAgent } = await loadRoute();
    const agent = registerAgent({
      id: `gsd-b22-${crypto.randomUUID().slice(0, 8)}`,
      name: "GSD Batch22",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const res = await POST(
      request(`${LOOPBACK}/api/gsd/model-route`, agent.apiKey, {
        body: "not-json",
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.actorAgentId).toBe(agent.agent.id);
  });

  it("routes task using agentId field when Authorization matches", async () => {
    const { POST, registerAgent } = await loadRoute();
    const agent = registerAgent({
      id: `gsd-b22-route-${crypto.randomUUID().slice(0, 8)}`,
      name: "GSD Route Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const res = await POST(
      request(`${LOOPBACK}/api/gsd/model-route`, agent.apiKey, {
        body: JSON.stringify({
          agentId: agent.agent.id,
          taskClass: "hard_reasoning",
          overrideTier: "frontier",
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.actorAgentId).toBe(agent.agent.id);
    expect(body.route.tier).toBe("frontier");
  });
});
