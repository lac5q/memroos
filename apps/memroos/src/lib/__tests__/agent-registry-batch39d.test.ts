// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b39d-${crypto.randomUUID()}`);

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, `agents-${crypto.randomUUID()}.db`);
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch39d", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.restoreAllMocks();
  });

  it("authenticateAgentKey returns null when registered_agents row is gone (458)", async () => {
    const { registerAgent, authenticateAgentKey, getDb, closeDb } = await loadRegistry();
    const id = `agent-b39d-${crypto.randomUUID()}`;
    const { apiKey } = registerAgent({
      id,
      name: "Ghost b39d",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    getDb().prepare("DELETE FROM registered_agents WHERE id = ?").run(id);
    expect(authenticateAgentKey(apiKey!, id)).toBeNull();
    closeDb();
  });
});