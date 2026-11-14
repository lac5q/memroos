// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b36-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const registryModule = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch36", () => {
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

  it.skip("registerAgent throws when row disappears before reread (333) — sticky mid-transaction delete", () => {});

  it("authenticateAgentKey returns null when agent is deregistered (458)", async () => {
    const { registerAgent, createAgentApiKey, deregisterAgent, authenticateAgentKey } = await loadRegistry();
    const id = `agent-dereg-b36-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id,
      name: "Deregistered B36",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    const key = createAgentApiKey(id);
    deregisterAgent(id);
    expect(authenticateAgentKey(key)).toBeNull();
  });

  it.skip("recordHeartbeat throws when agent row disappears after update (507) — sticky: internal getRegisteredAgent binding", () => {});
});
