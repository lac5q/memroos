// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => ({ password: "secret", url: "http://localhost:7474", database: "neo4j" }),
  neo4jHttpQuery: vi.fn(async () => ({ results: [{ data: [{ row: [0] }] }], errors: [] as unknown[] })),
}));

vi.mock("@/lib/db", () => ({ getDb: () => testDb, closeDb: () => {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  testDb.exec("DELETE FROM agent_memory_writes");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch35b", () => {
  it.skip("countStatus(null, []) unavailable metric (162, 345) — private category() only", () => {});

  it("knowledgeRows returns early when category filter excludes knowledge_file (555)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const response = await buildMemoryInventory(
      new URL(`http://localhost/api/memory-inventory?category=message&trace=b35b-${randomUUID().slice(0, 6)}`),
    );
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
  });

  it("knowledge category counts stay deferred until waitForKnowledge (621)", async () => {
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
});
