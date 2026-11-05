// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b28b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch28b — auth headers, edits, remote poll, capabilities", () => {
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

  it("authenticateAgentHeaders returns null without Bearer token", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentHeaders } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Hdr", role: "Worker", platform: "codex", protocol: "rest", issueApiKey: true });
    const key = createAgentApiKey(id);
    const headers = new Headers({ authorization: `Token ${key}` });
    expect(authenticateAgentHeaders(headers, id)).toBeNull();
  });

  it("updateAgentDetails rejects empty role trim", async () => {
    const { registerAgent, updateAgentDetails } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Edit", role: "Worker", platform: "codex", protocol: "rest" });
    expect(() => updateAgentDetails(id, { role: "   " })).toThrow(/role cannot be empty/);
  });

  it("listRegisteredAgents hides deregistered agents by default", async () => {
    const { registerAgent, deregisterAgent, listRegisteredAgents } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Gone", role: "Worker", platform: "codex", protocol: "rest" });
    deregisterAgent(id);
    expect(listRegisteredAgents().some((a) => a.id === id)).toBe(false);
    expect(listRegisteredAgents({ includeDeregistered: true }).some((a) => a.id === id)).toBe(true);
  });

  it("rowToRegisteredAgent treats array metadata and malformed capability tags as empty", async () => {
    const { registerAgent, getRegisteredAgent, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({
      id,
      name: "Meta",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      capabilities: [{ id: "cap-b28b", name: "Cap", description: "d", tags: ["ok"] }],
    });
    getDb().prepare("UPDATE registered_agents SET metadata = ? WHERE id = ?").run("[1,2,3]", id);
    getDb()
      .prepare("UPDATE agent_capabilities SET tags = ? WHERE agent_id = ?")
      .run("{not-json", id);
    const agent = getRegisteredAgent(id, { includeDeregistered: true });
    expect(agent?.metadata).toEqual({});
    expect(agent?.capabilities[0]?.tags).toEqual([]);
  });

  it("pollRemoteAgent marks unreachable when health fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("health-down-b28b");
    }));
    const { pollRemoteAgent } = await loadRegistry();
    const result = await pollRemoteAgent({
      id: "remote-b28b",
      name: "Remote",
      role: "Worker",
      platform: "codex",
      protocol: "a2a",
      location: "tailscale",
      host: "localhost",
      port: 8080,
      healthEndpoint: "/health",
      metadata: {},
      skills: [],
    });
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeNull();
  });
});
