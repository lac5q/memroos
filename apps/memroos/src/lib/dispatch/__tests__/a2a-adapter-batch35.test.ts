// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { RemoteAgentConfig } from "@/types";

const TEST_DB_DIR = path.join(os.tmpdir(), `a2a-adapter-b35-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "adapter.db");

function taskId() {
  return `task-b35-${randomUUID().slice(0, 8)}`;
}

function makeRemoteAgent(): RemoteAgentConfig {
  return {
    id: "adk-b35",
    name: "ADK B35",
    role: "Helper",
    platform: "gemini",
    protocol: "a2a",
    location: "local",
    host: "localhost",
    port: 8025,
    healthEndpoint: "/health",
    metadata: {
      a2a: {
        endpointUrl: "http://localhost:8025/a2a/b35",
        source: "adk",
      },
    },
  };
}

async function loadAdapterModules() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const adapterModule = await import("../a2a-adapter");
  const store = await import("@/lib/a2a/task-store");
  const dbModule = await import("@/lib/db");
  return { ...adapterModule, ...store, closeDb: dbModule.closeDb };
}

describe("a2aAdapter batch35", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadAdapterModules();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.unstubAllGlobals();
  });

  it("remoteTaskFrom ignores array evidence payloads (16)", async () => {
    const id = taskId();
    const task = {
      task_id: id,
      context_id: "ctx-b35",
      from_agent: "memroos",
      to_agent: "adk-b35",
      task_summary: "batch35 array evidence",
      input: {},
      priority: 1,
      dispatched_at: "2026-11-12T09:00:00.000Z",
    };
    const { a2aAdapter, getA2aTask } = await loadAdapterModules();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(["not", "a", "task"]), { status: 200 })),
    );
    const result = await a2aAdapter.dispatch(task, makeRemoteAgent());
    expect(result.accepted).toBe(true);
    expect(getA2aTask(id)).toBeNull();
  });

  it("mirrorRemoteTaskState no-ops when local task record missing (25)", async () => {
    const id = taskId();
    const task = {
      task_id: id,
      context_id: "ctx-b35",
      from_agent: "memroos",
      to_agent: "adk-b35",
      task_summary: "batch35 missing mirror",
      input: {},
      priority: 1,
      dispatched_at: "2026-11-12T09:00:00.000Z",
    };
    const { a2aAdapter, getA2aTask } = await loadAdapterModules();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id, status: { state: "completed" } }), { status: 200 }),
      ),
    );
    const result = await a2aAdapter.dispatch(task, makeRemoteAgent());
    expect(result.accepted).toBe(true);
    expect(getA2aTask(id)).toBeNull();
  });
});
