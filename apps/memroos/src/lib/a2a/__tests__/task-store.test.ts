// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_DB_DIR = path.join(os.tmpdir(), `a2a-task-store-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "tasks.db");

const MESSAGE = {
  messageId: "msg-1",
  role: "user" as const,
  parts: [{ kind: "text" as const, text: "hello from caller" }],
};

async function loadStore() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const store = await import("../task-store");
  const dbModule = await import("@/lib/db");
  return { ...store, getDb: dbModule.getDb, closeDb: dbModule.closeDb };
}

describe("A2A task store", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadStore();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("persists submitted task fields, message JSON, metadata JSON, and timestamps", async () => {
    const { createA2aTask, getDb } = await loadStore();

    const task = createA2aTask({
      taskId: "task-1",
      contextId: "ctx-1",
      callerAgentId: "caller-agent",
      targetAgentId: "target-agent",
      message: MESSAGE,
      metadata: { callerAgentId: "spoof-attempt", traceId: "trace-1" },
    });

    expect(task).toMatchObject({ id: "task-1", contextId: "ctx-1", status: { state: "submitted" } });
    const row = getDb().prepare("SELECT * FROM a2a_tasks WHERE task_id = ?").get("task-1") as any;
    expect(row).toMatchObject({
      task_id: "task-1",
      context_id: "ctx-1",
      caller_agent_id: "caller-agent",
      target_agent_id: "target-agent",
      state: "submitted",
    });
    expect(JSON.parse(row.message_json)).toMatchObject(MESSAGE);
    expect(JSON.parse(row.metadata_json)).toMatchObject({ traceId: "trace-1" });
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });

  it("increments per-task event sequence starting at 1", async () => {
    const { appendA2aTaskEvent, createA2aTask } = await loadStore();
    createA2aTask({ taskId: "task-2", contextId: "ctx-2", callerAgentId: "caller", message: MESSAGE });

    expect(appendA2aTaskEvent("task-2", "task.created", { ok: true }).sequence).toBe(1);
    expect(appendA2aTaskEvent("task-2", "task.updated", { ok: true }).sequence).toBe(2);
  });

  it("only allows submitted, working, input-required, completed, failed, canceled states", async () => {
    const { createA2aTask, transitionA2aTask } = await loadStore();
    createA2aTask({ taskId: "task-3", contextId: "ctx-3", callerAgentId: "caller", message: MESSAGE });

    for (const state of ["submitted", "working", "input-required", "completed", "failed", "canceled"] as const) {
      expect(transitionA2aTask("task-3", state).status.state).toBe(state);
    }
    expect(() => transitionA2aTask("task-3", "paused" as any)).toThrow(/state/i);
  });

  it("returns task plus ordered events", async () => {
    const { appendA2aTaskEvent, createA2aTask, getA2aTask } = await loadStore();
    createA2aTask({ taskId: "task-4", contextId: "ctx-4", callerAgentId: "caller", message: MESSAGE });
    appendA2aTaskEvent("task-4", "task.created", { first: true });
    appendA2aTaskEvent("task-4", "task.updated", { second: true });

    const record = getA2aTask("task-4");
    expect(record?.task.id).toBe("task-4");
    expect(record?.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("tolerates corrupt JSON columns when loading tasks and events", async () => {
    const { createA2aTask, getA2aTask, appendA2aTaskEvent, getDb } = await loadStore();
    createA2aTask({ taskId: "task-bad-json", contextId: "ctx-bad", callerAgentId: "caller", message: MESSAGE });
    appendA2aTaskEvent("task-bad-json", "task.created", { ok: true });
    getDb()
      .prepare(
        `UPDATE a2a_tasks SET message_json = ?, metadata_json = ?, artifacts_json = ? WHERE task_id = ?`
      )
      .run("{bad", "{bad", "{bad", "task-bad-json");
    getDb()
      .prepare(`UPDATE a2a_task_events SET payload_json = ? WHERE task_id = ?`)
      .run("{bad", "task-bad-json");

    const record = getA2aTask("task-bad-json");
    expect(record?.task.metadata).toEqual({});
    expect(record?.task.artifacts).toEqual([]);
    expect(record?.events[0]?.payload).toEqual({});
  });

  it("filters listed tasks to caller or target agent", async () => {
    const { createA2aTask, listA2aTasksForAgent } = await loadStore();
    createA2aTask({ taskId: "caller-task", contextId: "ctx-a", callerAgentId: "agent-a", targetAgentId: "agent-b", message: MESSAGE });
    createA2aTask({ taskId: "target-task", contextId: "ctx-b", callerAgentId: "agent-c", targetAgentId: "agent-a", message: MESSAGE });
    createA2aTask({ taskId: "hidden-task", contextId: "ctx-c", callerAgentId: "agent-c", targetAgentId: "agent-d", message: MESSAGE });

    expect(listA2aTasksForAgent("agent-a").map((task) => task.id).sort()).toEqual([
      "caller-task",
      "target-task",
    ]);
  });
});
