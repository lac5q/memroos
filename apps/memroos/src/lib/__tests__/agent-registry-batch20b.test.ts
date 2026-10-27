// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b20b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch20b", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRegistry();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.unstubAllGlobals();
  });

  it("listRegisteredAgents hides deregistered agents unless includeDeregistered is set", async () => {
    const { registerAgent, listRegisteredAgents, deregisterAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Codex", role: "Worker", platform: "codex", protocol: "rest" });
    deregisterAgent(id);
    expect(listRegisteredAgents().some((a) => a.id === id)).toBe(false);
    expect(listRegisteredAgents({ includeDeregistered: true }).some((a) => a.id === id)).toBe(true);
  });

  it("deregisterAgent returns null for unknown ids", async () => {
    const { deregisterAgent } = await loadRegistry();
    expect(deregisterAgent(`missing-${crypto.randomUUID()}`)).toBeNull();
  });

  it("authenticateAgentHeaders reads bearer token from headers", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentHeaders } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Header Auth", role: "Worker", platform: "codex", protocol: "rest", issueApiKey: true });
    const key = createAgentApiKey(id);
    const headers = new Headers({ authorization: `Bearer ${key}` });
    const authed = authenticateAgentHeaders(headers, id);
    expect(authed?.id).toBe(id);
  });

  it("updateAgentDetails rejects empty name updates", async () => {
    const { registerAgent, updateAgentDetails } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Patch", role: "Worker", platform: "codex", protocol: "rest" });
    expect(() => updateAgentDetails(id, { name: "  " })).toThrow(/name cannot be empty/);
  });
});
