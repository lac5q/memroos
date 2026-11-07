// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b28c-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch28c — successful auth and heartbeat refresh", () => {
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

  it("authenticateAgentKey returns agent and stamps last_used_at (lines 457-463)", async () => {
    const { registerAgent, authenticateAgentKey, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    const registered = registerAgent({
      id,
      name: "Auth28c",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const key = registered.apiKey!;
    const before = getDb()
      .prepare(`SELECT last_used_at FROM agent_api_keys WHERE agent_id = ?`)
      .get(id) as { last_used_at: string | null };
    expect(before.last_used_at).toBeNull();

    const agent = authenticateAgentKey(key, id);
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(id);
    const after = getDb()
      .prepare(`SELECT last_used_at FROM agent_api_keys WHERE agent_id = ?`)
      .get(id) as { last_used_at: string | null };
    expect(after.last_used_at).toBeTruthy();
  });

  it("recordHeartbeat returns refreshed agent row (lines 506-508)", async () => {
    const { registerAgent, recordHeartbeat, getRegisteredAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Beat28c", role: "Worker", platform: "codex", protocol: "rest" });
    const updated = recordHeartbeat(id, { status: "active", currentTask: "batch28c heartbeat" });
    expect(updated.currentTask).toBe("batch28c heartbeat");
    expect(getRegisteredAgent(id)?.lastHeartbeat).toBeTruthy();
  });

  it("parseObject treats array metadata as empty object (lines 85-91)", async () => {
    const { registerAgent, getRegisteredAgent, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Meta28c", role: "Worker", platform: "codex", protocol: "rest" });
    getDb().prepare("UPDATE registered_agents SET metadata = ? WHERE id = ?").run('["array","meta"]', id);
    expect(getRegisteredAgent(id)?.metadata).toEqual({});
  });
});
