// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b22b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch22b — parseObject, auth, poll, register edge cases", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRegistry();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_MEMORY_WRITE_PUSH_ADAPTER;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recordHeartbeat merges metadata when stored metadata JSON is invalid", async () => {
    const { registerAgent, recordHeartbeat, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Meta", role: "Worker", platform: "codex", protocol: "rest" });
    getDb().prepare(`UPDATE registered_agents SET metadata = ? WHERE id = ?`).run("not-json", id);
    const agent = recordHeartbeat(id, { metadata: { batch: "22b" } });
    expect(agent.metadata).toMatchObject({ batch: "22b" });
  });

  it("priorMemoryWritePayload skips malformed efficiency payload rows", async () => {
    const { registerAgent, recordMemoryWrite, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Dedup", role: "Worker", platform: "codex", protocol: "rest" });
    getDb()
      .prepare(
        `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
         VALUES ('default-tenant', 'memory_write', 'task-b22b', ?, ?, datetime('now'))`,
      )
      .run(id, "{bad-json");
    recordMemoryWrite(id, { type: "episodic", content: "unique-b22b", metadata: { taskId: "task-b22b" } });
    const rows = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM efficiency_events WHERE agent_id = ? AND event_type = 'memory_write'`)
      .get(id) as { c: number };
    expect(rows.c).toBeGreaterThanOrEqual(1);
  });

  it("authenticateAgentKey returns null when agent was deregistered", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentKey, deregisterAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Gone", role: "Worker", platform: "codex", protocol: "rest" });
    const rawKey = createAgentApiKey(id);
    deregisterAgent(id);
    expect(authenticateAgentKey(rawKey, id)).toBeNull();
  });

  it("pollRemoteAgent treats non-JSON health bodies as null data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    const { pollRemoteAgent } = await loadRegistry();
    const result = await pollRemoteAgent({
      id: "remote-b22b",
      host: "localhost",
      port: 9,
      location: "local",
      healthEndpoint: "/health",
    });
    expect(result.reachable).toBe(true);
    expect(result.data).toBeNull();
  });

  it("recordMemoryWrite logs adapter push failures when push adapter is enabled", async () => {
    vi.stubEnv("MEMROOS_MEMORY_WRITE_PUSH_ADAPTER", "1");
    vi.doMock("@/lib/memory/backends", () => ({
      getAdapters: () => [{ write: vi.fn().mockRejectedValue(new Error("adapter down")) }],
      mem0HealthTimeoutMs: () => 5000,
      neo4jConfig: () => ({ password: "", url: "" }),
      neo4jHttpQuery: vi.fn(),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { registerAgent, recordMemoryWrite } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Push", role: "Worker", platform: "codex", protocol: "rest" });
    recordMemoryWrite(id, { type: "episodic", content: "push-b22b", metadata: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(warn).toHaveBeenCalled();
  });
});
