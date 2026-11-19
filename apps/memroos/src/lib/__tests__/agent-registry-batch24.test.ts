// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b24-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch24 — auth, updates, adapter push", () => {
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
  });

  it("authenticateAgentKey rejects hints that do not match the stored agent id", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentKey } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Auth", role: "Worker", platform: "codex", protocol: "rest", issueApiKey: true });
    const key = createAgentApiKey(id);
    expect(authenticateAgentKey(key, "other-agent")).toBeNull();
    expect(authenticateAgentKey(key, id)?.id).toBe(id);
  });

  it("updateAgentDetails rejects empty name or role strings", async () => {
    const { registerAgent, updateAgentDetails } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Editable", role: "Worker", platform: "codex", protocol: "rest" });
    expect(() => updateAgentDetails(id, { name: "   " })).toThrow(/name cannot be empty/);
    expect(() => updateAgentDetails(id, { role: "" })).toThrow(/role cannot be empty/);
    const updated = updateAgentDetails(id, { name: "Renamed", role: "Ops" });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.role).toBe("Ops");
  });

  it("listRegisteredAgents can include deregistered agents when requested", async () => {
    const { registerAgent, deregisterAgent, listRegisteredAgents } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Listed", role: "Worker", platform: "codex", protocol: "rest" });
    deregisterAgent(id);
    expect(listRegisteredAgents().some((agent) => agent.id === id)).toBe(false);
    expect(listRegisteredAgents({ includeDeregistered: true }).some((agent) => agent.id === id)).toBe(true);
  });
});
