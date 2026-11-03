// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b27-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch27 — parseObject, register/heartbeat failures, adapter push", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    delete process.env.MEMROOS_MEMORY_WRITE_PUSH_ADAPTER;
  });

  afterEach(async () => {
    const { closeDb } = await loadRegistry();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.restoreAllMocks();
  });

  it("recordHeartbeat treats null stored metadata as empty object", async () => {
    const { registerAgent, recordHeartbeat, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "NullMeta", role: "Worker", platform: "codex", protocol: "rest" });
    getDb().prepare("UPDATE registered_agents SET metadata = ? WHERE id = ?").run("{bad-metadata", id);
    const agent = recordHeartbeat(id, { metadata: { lane: "batch27" } });
    expect(agent.metadata).toMatchObject({ lane: "batch27" });
  });

  it("authenticateAgentKey returns null after deregisterAgent", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentKey, deregisterAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Removed", role: "Worker", platform: "codex", protocol: "rest", issueApiKey: true });
    const key = createAgentApiKey(id);
    deregisterAgent(id);
    expect(authenticateAgentKey(key, id)).toBeNull();
  });

  it("recordMemoryWrite catches adapter push rejections when enabled", async () => {
    vi.stubEnv("MEMROOS_MEMORY_WRITE_PUSH_ADAPTER", "1");
    vi.doMock("@/lib/memory/backends", () => ({
      getAdapters: () => [{ write: vi.fn().mockRejectedValue(new Error("push-fail-b27")) }],
      mem0HealthTimeoutMs: () => 5000,
      neo4jConfig: () => ({ password: "", url: "" }),
      neo4jHttpQuery: vi.fn(),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { registerAgent, recordMemoryWrite } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Push", role: "Worker", platform: "codex", protocol: "rest" });
    recordMemoryWrite(id, { type: "episodic", content: "batch27-push", metadata: {} });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(warn).toHaveBeenCalled();
  });
});
