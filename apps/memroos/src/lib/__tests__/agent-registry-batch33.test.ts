// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b33-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const registryModule = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch33 — header auth and heartbeat", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRegistry();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it.skip("registerAgent throws when row disappears before reread (333) — requires mid-transaction delete", () => {
    // Sticky race: SQLite row vanishing between insert and getRegisteredAgent.
  });

  it("authenticateAgentHeaders accepts Bearer API keys (458)", async () => {
    const { registerAgent, authenticateAgentHeaders } = await loadRegistry();
    const id = `agent-b33-${randomUUID().slice(0, 8)}`;
    const { apiKey } = registerAgent({
      id,
      name: "Batch33 Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    const headers = new Headers({ authorization: `Bearer ${apiKey}` });
    const authed = authenticateAgentHeaders(headers, id);
    expect(authed?.id).toBe(id);
  });

  it("authenticateAgentKey returns null when agentIdHint mismatches (455)", async () => {
    const { registerAgent, authenticateAgentKey } = await loadRegistry();
    const id = `agent-hint-b33-${randomUUID().slice(0, 8)}`;
    const { apiKey } = registerAgent({
      id,
      name: "Hint Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    expect(authenticateAgentKey(apiKey!, `other-${randomUUID()}`)).toBeNull();
    expect(authenticateAgentKey(apiKey!, id)?.id).toBe(id);
  });

  it("recordHeartbeat returns merged agent row (507)", async () => {
    const { registerAgent, recordHeartbeat, getRegisteredAgent } = await loadRegistry();
    const id = `hb-b33-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id,
      name: "Heartbeat Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    const updated = recordHeartbeat(id, { status: "active", currentTask: "batch33 task", metadata: { lane: "b33" } });
    expect(updated.currentTask).toBe("batch33 task");
    expect(getRegisteredAgent(id)?.metadata).toMatchObject({ lane: "b33" });
  });
});
