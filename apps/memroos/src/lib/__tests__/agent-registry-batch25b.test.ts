// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b25b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch25b — heartbeat and header auth", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRegistry();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.restoreAllMocks();
  });

  it("recordHeartbeat updates last_seen metadata for a registered agent", async () => {
    const { registerAgent, recordHeartbeat, getRegisteredAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Heartbeat", role: "Worker", platform: "codex", protocol: "rest" });
    recordHeartbeat(id, { status: "active", currentTask: "batch25b task" });
    const agent = getRegisteredAgent(id);
    expect(agent?.lastHeartbeat).toBeTruthy();
    expect(agent?.status).toBe("active");
  });

  it("authenticateAgentHeaders reads bearer tokens from Headers", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentHeaders } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Header Auth", role: "Worker", platform: "codex", protocol: "rest", issueApiKey: true });
    const key = createAgentApiKey(id);
    const headers = new Headers({ authorization: `Bearer ${key}` });
    expect(authenticateAgentHeaders(headers, id)?.id).toBe(id);
    expect(authenticateAgentHeaders(new Headers(), id)).toBeNull();
  });
});
