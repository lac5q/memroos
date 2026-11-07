// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [0] }] }], errors: [] as unknown[] }));
const neo4jConfig = vi.fn(() => ({ password: "", url: "http://localhost:7474" }));

vi.mock("@/lib/db", () => ({ getDb: () => testDb, closeDb: () => {} }));
vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => neo4jConfig(),
  neo4jHttpQuery: (...args: unknown[]) => neo4jHttpQuery(...args),
}));

beforeEach(() => {
  vi.resetModules();
  neo4jHttpQuery.mockClear();
  neo4jConfig.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("memory-inventory batch28b — graph password gate and neo4j query failures", () => {
  it("graph_fact category is degraded when Neo4j password is unset", async () => {
    neo4jConfig.mockReturnValue({ password: "", url: "http://localhost:7474" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const graph = categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBeNull();
    expect(graph?.metric.reason).toMatch(/password/i);
    expect(neo4jHttpQuery).not.toHaveBeenCalled();
  });

  it("graph_fact category surfaces neo4jHttpQuery errors as degraded", async () => {
    neo4jConfig.mockReturnValue({ password: "test-neo4j-b28b", url: "http://localhost:7474" });
    neo4jHttpQuery.mockRejectedValueOnce(new Error("neo4j-query-failed-b28b"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const graph = categories.find((c) => c.id === "graph_fact");
    expect(graph?.status).toBe("degraded");
    expect(graph?.metric.reason).toMatch(/neo4j-query-failed-b28b/);
  });

  it("episodic_write rows filter by agent query param", async () => {
    const agentA = `agent-a-${crypto.randomUUID().slice(0, 6)}`;
    const agentB = `agent-b-${crypto.randomUUID().slice(0, 6)}`;
    for (const id of [agentA, agentB]) {
      testDb
        .prepare(
          `INSERT INTO registered_agents (id, name, role, platform, protocol, status)
           VALUES (?, ?, 'Worker', 'codex', 'rest', 'active')`,
        )
        .run(id, id);
    }
    testDb.prepare(
      `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
       VALUES (?, 'episodic', ?, '{}', '{}', datetime('now'))`,
    ).run(agentA, "hash-b28b-a");
    testDb.prepare(
      `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
       VALUES (?, 'episodic', ?, '{}', '{}', datetime('now'))`,
    ).run(agentB, "hash-b28b-b");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL(`http://localhost/api/memory-inventory?category=episodic_write&agent=${agentA}`),
    );
    expect(response.rows.every((row) => row.source === agentA)).toBe(true);
    expect(response.rows.some((row) => row.source === agentB)).toBe(false);
    testDb.exec("DELETE FROM agent_memory_writes");
  });
});
