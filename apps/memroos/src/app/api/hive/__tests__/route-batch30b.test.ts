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

const { GET, POST } = await import("../route");

function getReq(params: Record<string, string>) {
  const url = new URL("http://localhost/api/hive");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: "GET" });
}

afterAll(() => testDb.close());

describe("GET /api/hive batch30b", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM hive_actions").run();
    testDb.prepare("DELETE FROM hive_delegations").run();
  });

  it("returns context_id lineage with null artifacts preserved", async () => {
    const contextId = `ctx-${randomUUID().slice(0, 8)}`;
    testDb
      .prepare(
        `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts, session_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "agent-b30b",
        "continue",
        "summary",
        JSON.stringify({ context_id: contextId }),
        null,
        new Date().toISOString(),
      );

    const res = await GET(getReq({ context_id: contextId }) as never);
    const body = await res.json();
    expect(body.actions[0].artifacts).toEqual({ context_id: contextId });
  });

  // Invalid artifacts JSON on lineage rows is unreachable: FTS/json_extract filters exclude corrupt rows.

  it("filters delegations by to_agent only", async () => {
    const target = `target-${randomUUID().slice(0, 6)}`;
    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(`t1-${randomUUID().slice(0, 4)}`, "a", target, "one", 1, "pending");
    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(`t2-${randomUUID().slice(0, 4)}`, "a", "other", "two", 1, "pending");

    const body = await (await GET(getReq({ type: "delegation", to_agent: target }) as never)).json();
    expect(body.delegations).toHaveLength(1);
    expect(body.delegations[0].to_agent).toBe(target);
  });

  it("lists delegations by status filter without to_agent", async () => {
    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(`active-${randomUUID().slice(0, 4)}`, "a", "b", "active task", 1, "active");
    const body = await (await GET(getReq({ type: "delegation", status: "active" }) as never)).json();
    expect(body.delegations.some((d: { status: string }) => d.status === "active")).toBe(true);
  });
});

describe("POST /api/hive batch30b", () => {
  it("writes action with null artifacts", async () => {
    const res = await POST(
      new Request("http://localhost/api/hive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: "agent-b30b",
          action_type: "loop",
          summary: `summary ${randomUUID().slice(0, 4)}`,
        }),
      }) as never,
    );
    expect(res.status).toBe(200);
  });
});
