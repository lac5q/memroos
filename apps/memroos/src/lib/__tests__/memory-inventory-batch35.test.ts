// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [2] }] }], errors: [] as unknown[] }));
const neo4jConfig = vi.fn(() => ({ password: "secret", url: "http://localhost:7474", database: "neo4j" }));

vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => neo4jConfig(),
  neo4jHttpQuery: (...args: unknown[]) => neo4jHttpQuery(...args),
}));

vi.mock("@/lib/db", () => ({ getDb: () => testDb, closeDb: () => {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  neo4jHttpQuery.mockClear();
  testDb.exec("DELETE FROM agent_memory_writes");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch35 — safeJson and knowledge deferral", () => {
  it.skip("countStatus(null, []) unavailable metric (162, 345) — private category() only", () => {});

  it("episodic rows tolerate non-object and invalid metadata via safeJson (545-550)", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b35', 'Agent B35', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b35', 'note', 'hash-b35', ?, 'ok', '2026-03-05T00:00:00.000Z')`,
      )
      .run(`"primitive-b35"`);
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b35', 'note', 'hash-b35b', ?, 'ok', '2026-03-05T00:01:00.000Z')`,
      )
      .run("{not-json");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory?category=episodic_write"));
    expect(response.rows.length).toBeGreaterThanOrEqual(2);
    expect(response.rows.every((row) => row.category === "episodic_write")).toBe(true);
  });

  it("knowledge category stays deferred until waitForKnowledge is true (621-625)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const knowledge = categories.find((c) => c.id === "knowledge_file");
    expect(knowledge?.count).toBeNull();
    expect(knowledge?.warnings.some((w) => w.includes("deferred"))).toBe(true);
  });

  it("knowledgeRows early return when category filter excludes knowledge_file (555)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory?category=message"));
    expect(response.rows.some((row) => row.category === "knowledge_file")).toBe(false);
  });
});
