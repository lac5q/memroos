// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";

const TEST_DB_DIR = path.join(os.tmpdir(), `misc-b28e-${crypto.randomUUID()}`);

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, `agents-${crypto.randomUUID()}.db`);
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb, getDb: dbModule.getDb };
}

describe("misc lib batch28e — parsers, agent-registry, erasure, live, entity-extraction", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_MEMORY_WRITE_PUSH_ADAPTER;
    vi.restoreAllMocks();
  });

  it("parseAgents skips non-directory entries (parsers line 69)", async () => {
    const configs = path.join(TEST_DB_DIR, "agents-config-b28e");
    fs.mkdirSync(configs, { recursive: true });
    fs.writeFileSync(path.join(configs, "not-a-dir.txt"), "noop", "utf8");
    const agentDir = path.join(configs, "agent-one-b28e");
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# ok\n", "utf8");
    const { parseAgents } = await import("../parsers");
    const agents = await parseAgents(configs);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe("agent-one-b28e");
  });

  it("parseModelUsage skips jsonl files older than since window (parsers line 426)", async () => {
    const home = path.join(TEST_DB_DIR, "home-b28e");
    const project = path.join(home, ".claude", "projects", "proj-b28e");
    fs.mkdirSync(project, { recursive: true });
    const oldFile = path.join(project, "old-b28e.jsonl");
    fs.writeFileSync(
      oldFile,
      `${JSON.stringify({
        type: "assistant",
        timestamp: "2020-01-01T00:00:00.000Z",
        message: { model: "claude-old-b28e", usage: { input_tokens: 1, output_tokens: 1 } },
      })}\n`,
      "utf8",
    );
    const oldDate = new Date("2019-06-01T00:00:00.000Z");
    fs.utimesSync(oldFile, oldDate, oldDate);
    process.env.HOME = home;
    const { parseModelUsage } = await import("../parsers");
    const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
    expect(usage.models.find((m) => m.id === "claude-old-b28e")).toBeUndefined();
  });

  it("parseObject handles null metadata via heartbeat (agent-registry line 86)", async () => {
    const { registerAgent, recordHeartbeat, getDb, closeDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "NullMeta", role: "Worker", platform: "codex", protocol: "rest" });
    getDb().prepare("UPDATE registered_agents SET metadata = ? WHERE id = ?").run("", id);
    const updated = recordHeartbeat(id, { status: "active", metadata: { batch28e: true } });
    expect(updated.metadata).toEqual({ batch28e: true });
    closeDb();
  });

  it("authenticateAgentKey returns null when agent row missing (line 458)", async () => {
    const { registerAgent, authenticateAgentKey, getDb, closeDb } = await loadRegistry();
    const id = `agent-${crypto.randomUUID()}`;
    const { apiKey } = registerAgent({
      id,
      name: "Ghost",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      issueApiKey: true,
    });
    getDb().prepare("DELETE FROM registered_agents WHERE id = ?").run(id);
    expect(authenticateAgentKey(apiKey!, id)).toBeNull();
    closeDb();
  });

  it("recordMemoryWrite adapter push catch logs failures (line 567)", async () => {
    process.env.MEMROOS_MEMORY_WRITE_PUSH_ADAPTER = "1";
    vi.resetModules();
    vi.doMock("@/lib/memory/registry", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/memory/registry")>();
      return {
        ...actual,
        getAdapters: () => [{ write: vi.fn().mockRejectedValue(new Error("adapter fail b28e")) }],
      };
    });
    process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, `mem-write-${crypto.randomUUID()}.db`);
    const registryModule = await import("@/lib/agent-registry");
    const dbModule = await import("@/lib/db");
    const { registerAgent, recordMemoryWrite } = registryModule;
    const closeDb = dbModule.closeDb;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = `agent-${crypto.randomUUID()}`;
    registerAgent({ id, name: "Push", role: "Worker", platform: "codex", protocol: "rest" });
    recordMemoryWrite(id, { type: "vector", content: "batch28e memory push" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(warn).toHaveBeenCalledWith("[recordMemoryWrite] adapter push failed", "vector", expect.any(Error));
    closeDb();
    vi.doUnmock("@/lib/memory/registry");
  });

  it("evaluateLivePolicy denies invalid purpose and malformed candidate scope (live 78-81,106,150)", async () => {
    const { evaluateLivePolicy } = await import("../retrieval-bench/adapters/live");
    const task = { id: "t1", question: "q", expected_answer: "a", abstention_correct: false } as const;
    const baseScope = {
      tenantId: "tenant-b28e",
      userId: "user-b28e",
      agentId: "agent-b28e",
      spaceId: "space-b28e",
      purpose: "recall",
      beliefStage: "gold_claim",
      label: { visibility: "internal", policy: "agent_visible", domain: "client", sensitivity: "internal" },
      maxFreshnessSeconds: null,
    };
    expect(
      evaluateLivePolicy({
        task: task as never,
        scope: { ...baseScope, purpose: "not-a-live-purpose" },
        candidate: { id: "c1", timestamp_iso: new Date().toISOString(), scope: baseScope },
      }).reason,
    ).toBe("invalid_purpose");

    expect(
      evaluateLivePolicy({
        task: task as never,
        scope: { ...baseScope, userId: "" },
        candidate: { id: "c1", timestamp_iso: new Date().toISOString(), scope: baseScope },
      }).reason,
    ).toBe("incomplete_scope");

    expect(
      evaluateLivePolicy({
        task: task as never,
        scope: baseScope,
        candidate: { id: "c1", timestamp_iso: new Date().toISOString(), scope: null },
      }).reason,
    ).toBe("candidate_scope_missing");
  });

  it("extractEntities classifies dates, identifiers, and newline surfaces (entity-extraction 271-277,362-363)", async () => {
    const { extractEntities } = await import("../retrieval-bench/modules/entity-extraction");
    const iso = extractEntities("Event on 2026-07-17 with batch28e");
    expect(iso.entities.some((e) => e.kind === "date")).toBe(true);

    const id = extractEntities("Reference ticket AB-12001 closed");
    expect(id.entities.some((e) => e.kind === "identifier")).toBe(true);

    const newline = extractEntities("Start\nAcme Corp continues");
    expect(newline.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });
});
