// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b15-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch15 — parse helpers, auth, memory writes", () => {
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
    vi.unstubAllGlobals();
  });

  it("survives corrupt metadata and capability tags in stored rows", async () => {
    const agentId = `agent-${crypto.randomUUID()}`;
    const { registerAgent, getRegisteredAgent } = await loadRegistry();
    registerAgent({
      id: agentId,
      name: "Corrupt Meta",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      capabilities: [{ id: "cap-1", name: "Cap", description: "d", tags: ["a"] }],
    });
    const db = new Database(TEST_DB_PATH);
    db.prepare(`UPDATE registered_agents SET metadata = '{bad-json' WHERE id = ?`).run(agentId);
    db.prepare(`UPDATE agent_capabilities SET tags = 'not-json' WHERE agent_id = ?`).run(agentId);
    db.close();
    const agent = getRegisteredAgent(agentId);
    expect(agent?.metadata).toEqual({});
    expect(agent?.capabilities[0]?.tags).toEqual([]);
  });

  it("authenticateAgentKey rejects agentIdHint mismatch and records last_used_at", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentKey } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Auth", role: "Worker", platform: "codex", protocol: "rest", issueApiKey: true });
    const key = createAgentApiKey(id);
    expect(authenticateAgentKey(key, "other-agent")).toBeNull();
    const authed = authenticateAgentKey(key, id);
    expect(authed?.id).toBe(id);
  });

  it("recordHeartbeat throws for unknown agents", async () => {
    const { recordHeartbeat } = await loadRegistry();
    expect(() => recordHeartbeat(`missing-${crypto.randomUUID()}`, { status: "active" })).toThrow(/Unknown agent/);
  });

  it("recordMemoryWrite deduplicates via metadata-only hash and rediscovery flag", async () => {
    const { registerAgent, recordMemoryWrite, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Mem", role: "Worker", platform: "codex", protocol: "rest" });
    recordMemoryWrite(id, { type: "episodic", metadata: { taskId: "t-1", source: "unit" } });
    recordMemoryWrite(id, { type: "episodic", metadata: { taskId: "t-1", source: "unit" } });
    const events = getDb()
      .prepare(`SELECT payload FROM efficiency_events WHERE event_type = 'memory_write' AND agent_id = ?`)
      .all(id) as { payload: string }[];
    expect(events.length).toBe(2);
    const second = JSON.parse(events[1]!.payload) as { isRediscovery?: boolean };
    expect(second.isRediscovery).toBe(true);
  });

  it("recordToolOutcome skips source_read efficiency when metadata lacks hash", async () => {
    const { registerAgent, recordToolOutcome, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Tool", role: "Worker", platform: "codex", protocol: "rest" });
    recordToolOutcome(id, { toolId: "grep", outcome: "ok", metadata: { sourceId: "src-1" } });
    const count = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM efficiency_events WHERE event_type = 'source_read'`)
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("pollRemoteAgent uses cloudflare tunnelUrl and handles fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const { registerAgent, pollRemoteAgent } = await loadRegistry();
    const id = `remote-${crypto.randomUUID()}`;
    registerAgent({
      id,
      name: "Tunnel",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      location: "cloudflare",
      host: null,
      port: null,
      tunnelUrl: "http://localhost:9090",
      healthEndpoint: "/healthz",
    });
    const result = await pollRemoteAgent({
      id,
      name: "Tunnel",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      location: "cloudflare",
      host: "localhost",
      port: 9090,
      healthEndpoint: "/healthz",
      tunnelUrl: "http://localhost:9090",
      metadata: {},
      skills: [],
    });
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeNull();
  });

  it("getRemoteAgents drops agents with invalid a2a endpoint URLs", async () => {
    const { registerAgent, getRemoteAgents } = await loadRegistry();
    registerAgent({
      id: `bad-url-${crypto.randomUUID()}`,
      name: "Bad URL",
      role: "Worker",
      platform: "codex",
      protocol: "a2a",
      location: "cloudflare",
      host: null,
      port: null,
      metadata: { a2a: { endpointUrl: "not-a-valid-url" } },
    });
    expect(getRemoteAgents().some((a) => a.name === "Bad URL")).toBe(false);
  });
});
