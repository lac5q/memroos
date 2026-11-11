// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b30b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("agent-registry batch30b — heartbeat status and capability retention", () => {
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

  it("recordHeartbeat preserves explicit status override (line 458)", async () => {
    const { registerAgent, recordHeartbeat, getRegisteredAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Beat", role: "Worker", platform: "codex", protocol: "rest" });
    const updated = recordHeartbeat(id, { status: "idle", currentTask: "batch30b" });
    expect(updated.status).toBe("idle");
    expect(getRegisteredAgent(id)?.currentTask).toBe("batch30b");
  });

  it("registerAgent re-register without capabilities leaves durable caps (line 324)", async () => {
    const { registerAgent, getRegisteredAgent } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({
      id,
      name: "Cap",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      capabilities: [{ id: "cap-b30b", name: "Cap", description: "d", tags: ["ok"] }],
    });
    registerAgent({
      id,
      name: "Cap",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    expect(getRegisteredAgent(id)?.capabilities).toHaveLength(1);
  });

  it("recordHeartbeat throws for unknown agent before update (line 476)", async () => {
    const { recordHeartbeat } = await loadRegistry();
    expect(() => recordHeartbeat(`missing-${crypto.randomUUID()}`, { status: "active" })).toThrow(/Unknown agent/);
  });

  // unreachable in practice: post-register getRegisteredAgent null (333) and post-heartbeat reload null (507)
  // require mocking non-configurable live ESM bindings — covered indirectly via integration suites.
});
