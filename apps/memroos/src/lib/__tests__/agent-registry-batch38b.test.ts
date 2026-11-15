// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b38b-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const registryModule = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch38b", () => {
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

  it.skip("registerAgent throw when getRegisteredAgent null (333) — sticky mid-transaction delete", () => {});

  it.skip("recordHeartbeat throw when reload null (507) — sticky internal binding", () => {});

  it("authenticateAgentKey returns null when agent row missing (458)", async () => {
    const { registerAgent, authenticateAgentKey } = await loadRegistry();
    const { getDb } = await import("@/lib/db");
    const id = `agent-b38b-${randomUUID().slice(0, 8)}`;
    const { apiKey } = registerAgent({
      id,
      name: "Ghost B38b",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    getDb().prepare("DELETE FROM registered_agents WHERE id = ?").run(id);
    expect(authenticateAgentKey(apiKey!, id)).toBeNull();
  });
});