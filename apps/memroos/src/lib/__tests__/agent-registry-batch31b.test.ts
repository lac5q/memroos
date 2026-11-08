// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b31b-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch31b — api key auth guards", () => {
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

  it("authenticateAgentKey rejects agentIdHint mismatches (line 455)", async () => {
    const { registerAgent, authenticateAgentKey } = await loadRegistry();
    const id = `agent-${randomUUID()}`;
    const { apiKey } = registerAgent({
      id,
      name: "Hint",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    expect(authenticateAgentKey(apiKey!, `other-${randomUUID()}`)).toBeNull();
    expect(authenticateAgentKey(apiKey!, id)?.id).toBe(id);
  });

  it("authenticateAgentKey returns null when the agent row is dormant (line 458)", async () => {
    const { registerAgent, authenticateAgentKey, deregisterAgent } = await loadRegistry();
    const id = `agent-${randomUUID()}`;
    const { apiKey } = registerAgent({
      id,
      name: "Dormant",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    deregisterAgent(id);
    expect(authenticateAgentKey(apiKey!)).toBeNull();
  });

  // Line 333 / 507: post-register or post-heartbeat reload null — not reachable without mocking live ESM bindings.
});
