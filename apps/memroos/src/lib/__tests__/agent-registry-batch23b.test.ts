// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b23b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch23b — metadata parsing and memory writes", () => {
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

  it("recordMemoryWrite records efficiency events for repeated content hashes", async () => {
    const { registerAgent, recordMemoryWrite, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "HashMeta", role: "Worker", platform: "codex", protocol: "rest" });
    recordMemoryWrite(id, {
      type: "note",
      content: "same body batch23b",
      metadata: { source_hash: "sha256:" + "a".repeat(64) },
    });
    recordMemoryWrite(id, {
      type: "note",
      content: "same body batch23b",
      metadata: { source_hash: "sha256:" + "a".repeat(64) },
    });
    const rediscovery = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM efficiency_events WHERE agent_id = ? AND event_type = 'memory_write'`)
      .get(id) as { c: number };
    expect(rediscovery.c).toBe(2);
  });

  it("recordHeartbeat merges object metadata over invalid stored JSON", async () => {
    const { registerAgent, recordHeartbeat, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "BadMeta", role: "Worker", platform: "codex", protocol: "rest" });
    getDb().prepare(`UPDATE registered_agents SET metadata = ? WHERE id = ?`).run("{not-json", id);
    const agent = recordHeartbeat(id, { metadata: { lane: "batch23b" } });
    expect(agent.metadata).toMatchObject({ lane: "batch23b" });
  });
});
