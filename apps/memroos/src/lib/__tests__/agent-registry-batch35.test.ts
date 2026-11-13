// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b35-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const registryModule = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch35 — api key omission, adapter push, heartbeat merge", () => {
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

  it.skip("registerAgent throws when row disappears before reread (333) — sticky mid-transaction delete", () => {});

  it("registerAgent without issueApiKey omits apiKey (458)", async () => {
    const { registerAgent } = await loadRegistry();
    const id = `agent-no-key-b35-${randomUUID().slice(0, 8)}`;
    const result = registerAgent({
      id,
      name: "No Key Agent B35",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: false,
    });
    expect(result).not.toHaveProperty("apiKey");
    expect(result.agent.id).toBe(id);
  });

  it("recordHeartbeat preserves metadata when only status changes (507)", async () => {
    const { registerAgent, recordHeartbeat, getRegisteredAgent } = await loadRegistry();
    const id = `hb-b35-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id,
      name: "HB B35",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    recordHeartbeat(id, { metadata: { lane: "b35", depth: 2 } });
    const updated = recordHeartbeat(id, { status: "idle" });
    expect(updated.status).toBe("idle");
    expect(getRegisteredAgent(id)?.metadata).toMatchObject({ lane: "b35", depth: 2 });
  });

  it("recordMemoryWrite with adapter push enabled does not throw (567)", async () => {
    const { registerAgent, recordMemoryWrite } = await loadRegistry();
    const id = `mem-push-b35-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id,
      name: "Memory Push B35",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    vi.stubEnv("MEMROOS_MEMORY_WRITE_PUSH_ADAPTER", "1");
    const registry = await import("@/lib/memory/registry");
    const mockAdapter = { write: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(registry, "getAdapters").mockReturnValue([mockAdapter as never]);
    recordMemoryWrite(id, { type: "vector", content: "batch35 vector memory", metadata: { taskId: "task-b35" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockAdapter.write).toHaveBeenCalled();
  });
});
