// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b35b-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const registryModule = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch35b", () => {
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

  it("registerAgent without issueApiKey omits apiKey field (458)", async () => {
    const { registerAgent } = await loadRegistry();
    const id = `agent-no-key-b35b-${randomUUID().slice(0, 8)}`;
    const result = registerAgent({
      id,
      name: "No Key Agent B35B",
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
    const id = `hb-b35b-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id,
      name: "HB B35B",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    recordHeartbeat(id, { metadata: { lane: "b35b", depth: 3 } });
    const updated = recordHeartbeat(id, { status: "idle" });
    expect(updated.status).toBe("idle");
    expect(getRegisteredAgent(id)?.metadata).toMatchObject({ lane: "b35b", depth: 3 });
  });
});
