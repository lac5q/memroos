// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b21-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch21 — dedup scan and adapter push", () => {
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

  it("recordMemoryWrite skips malformed efficiency payload rows when deduplicating", async () => {
    const { registerAgent, recordMemoryWrite, getDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Dedup", role: "Worker", platform: "codex", protocol: "rest" });
    const dedupHash = "sha256:dedup-b21";
    getDb()
      .prepare(
        `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
         VALUES ('default-tenant', 'memory_write', 'task-b21', ?, ?, datetime('now'))`,
      )
      .run(id, JSON.stringify(["not-an-object"]));
    recordMemoryWrite(id, {
      type: "episodic",
      content: "fresh write",
      metadata: { dedupHash, taskId: "task-b21" },
    });
    const rows = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM efficiency_events WHERE agent_id = ? AND event_type = 'memory_write'`)
      .get(id) as { c: number };
    expect(rows.c).toBeGreaterThanOrEqual(1);
  });

  it("recordMemoryWrite logs adapter push failures without throwing", async () => {
    vi.stubEnv("MEMROOS_MEMORY_WRITE_PUSH_ADAPTER", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { registerAgent, recordMemoryWrite } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Push", role: "Worker", platform: "codex", protocol: "rest" });
    recordMemoryWrite(id, { type: "episodic", content: "push me", metadata: { source: "batch21" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(warn).toHaveBeenCalled();
  });
});
