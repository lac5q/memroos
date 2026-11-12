// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => new Response("{}", { status: 401 }),
}));

const { GET } = await import("../route");

function getReq(params: Record<string, string>) {
  const url = new URL("http://localhost/api/hive");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: "GET" });
}

afterAll(() => testDb.close());

describe("GET /api/hive batch33", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM hive_actions").run();
    testDb.prepare("DELETE FROM hive_delegations").run();
  });

  it("returns raw artifacts when JSON.parse fails on task_id lineage (L48)", async () => {
    const taskId = `task-b33-${randomUUID().slice(0, 8)}`;
    const sqliteOnlyJson = `{"task_id":"${taskId}",}`;
    testDb
      .prepare(
        `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts, session_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("agent-b33", "continue", "summary", sqliteOnlyJson, null, new Date().toISOString());

    const res = await GET(getReq({ task_id: taskId }) as never);
    const body = await res.json();
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].artifacts).toBe(sqliteOnlyJson);
  });

  it("returns raw artifacts when JSON.parse fails on context_id lineage (L75)", async () => {
    const contextId = `ctx-b33-${randomUUID().slice(0, 8)}`;
    const sqliteOnlyJson = `{"context_id":"${contextId}",}`;
    testDb
      .prepare(
        `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts, session_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("agent-b33", "trigger", "bad artifacts", sqliteOnlyJson, null, new Date().toISOString());

    const res = await GET(getReq({ context_id: contextId }) as never);
    const body = await res.json();
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].artifacts).toBe(sqliteOnlyJson);
  });
});
