// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b23-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch23 — parse helpers, auth hint, register without api key", () => {
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

  it("registerAgent without issueApiKey returns agent only", async () => {
    const { registerAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    const result = registerAgent({
      id,
      name: "NoKey",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: false,
    });
    expect(result.agent.id).toBe(id);
    expect("apiKey" in result).toBe(false);
  });

  it("authenticateAgentKey rejects hint mismatches before updating last_used_at", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentKey } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Hint", role: "Worker", platform: "codex", protocol: "rest" });
    const rawKey = createAgentApiKey(id);
    expect(authenticateAgentKey(rawKey, "other-agent")).toBeNull();
    expect(authenticateAgentKey(rawKey, id)?.id).toBe(id);
  });

  it("recordHeartbeat tolerates array-shaped metadata JSON in storage", async () => {
    const { registerAgent, recordHeartbeat, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "ArrayMeta", role: "Worker", platform: "codex", protocol: "rest" });
    getDb().prepare(`UPDATE registered_agents SET metadata = ? WHERE id = ?`).run("[]", id);
    const agent = recordHeartbeat(id, { metadata: { lane: "batch23" } });
    expect(agent.metadata).toMatchObject({ lane: "batch23" });
  });

  it("authenticateAgentHeaders parses bearer tokens", async () => {
    const { registerAgent, createAgentApiKey, authenticateAgentHeaders } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Bearer", role: "Worker", platform: "codex", protocol: "rest" });
    const rawKey = createAgentApiKey(id);
    const headers = new Headers({ authorization: `Bearer ${rawKey}` });
    expect(authenticateAgentHeaders(headers, id)?.id).toBe(id);
    expect(authenticateAgentHeaders(new Headers(), id)).toBeNull();
  });
});
