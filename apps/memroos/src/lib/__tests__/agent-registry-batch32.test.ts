// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b32-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch32 — happy-path registration", () => {
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

  // sticky: post-register getRegisteredAgent null throw (333) — only reachable if SQLite row disappears mid-tx.

  it("registerAgent returns persisted agent when registration succeeds", async () => {
    const { registerAgent, getRegisteredAgent } = await loadRegistry();
    const id = `agent-b32-${randomUUID().slice(0, 8)}`;
    const { agent, apiKey } = registerAgent({
      id,
      name: "Batch32 Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
      capabilities: [{ id: "cap-b32", name: "Recall", description: "batch32", tags: ["batch32"] }],
    });
    expect(agent.id).toBe(id);
    expect(apiKey).toMatch(/^ak_/);
    expect(getRegisteredAgent(id)?.name).toBe("Batch32 Agent");
  });
});
