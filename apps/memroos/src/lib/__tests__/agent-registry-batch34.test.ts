// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-reg-b34-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const registryModule = await import("@/lib/agent-registry");
  const dbModule = await import("@/lib/db");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

describe("agent-registry batch34", () => {
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

  it.skip("registerAgent throws when row disappears before reread (333)", () => {});

  it("registerAgent without issueApiKey omits apiKey (458 branch)", async () => {
    const { registerAgent, authenticateAgentHeaders } = await loadRegistry();
    const id = `agent-no-key-b34-${randomUUID().slice(0, 8)}`;
    const result = registerAgent({
      id,
      name: "No Key Agent",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: false,
    });
    expect(result).not.toHaveProperty("apiKey");
    expect(authenticateAgentHeaders(new Headers(), id)).toBeNull();
  });

  it("recordHeartbeat preserves prior metadata when partial update (507)", async () => {
    const { registerAgent, recordHeartbeat, getRegisteredAgent } = await loadRegistry();
    const id = `hb-b34-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id,
      name: "HB B34",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
    });
    recordHeartbeat(id, { metadata: { lane: "b34", depth: 1 } });
    const updated = recordHeartbeat(id, { status: "idle" });
    expect(updated.status).toBe("idle");
    expect(getRegisteredAgent(id)?.metadata).toMatchObject({ lane: "b34", depth: 1 });
  });
});
