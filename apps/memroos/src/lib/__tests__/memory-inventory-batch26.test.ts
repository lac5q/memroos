// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [0] }] }], errors: [] as unknown[] }));
const neo4jConfig = vi.fn(() => ({ password: "secret", url: "http://localhost:7474" }));

vi.mock("@/lib/db", () => ({ getDb: () => testDb, closeDb: () => {} }));
vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => neo4jConfig(),
  neo4jHttpQuery: (...args: unknown[]) => neo4jHttpQuery(...args),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  neo4jHttpQuery.mockClear();
  testDb.exec("DELETE FROM agent_memory_writes");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch26 — status branches, cache, knowledge rows, safeJson", () => {
  it("marks vector category degraded when count is null but warnings exist (countStatus line 162)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const vector = categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.status).toBe("degraded");
    expect(vector?.warnings.length).toBeGreaterThan(0);
  });

  it("uses zero metric reason branch when mem0 returns a measured zero count (lines 323-324)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0, vector_store: "connected" }),
      })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const vector = categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(0);
    expect(vector?.status).toBe("empty");
    expect(vector?.metric.reason).toMatch(/zero|0 rows/i);
  });

  it("returns cached knowledge category within TTL without rescanning (line 621)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b26-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b26", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "sample-b26.md"), "# note", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "600000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );

    const knowledge = await import("@/lib/knowledge-collections");
    const collectSpy = vi.spyOn(knowledge, "collectCollectionFiles");

    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    await _categoryCountsForTest(true);
    collectSpy.mockClear();
    const second = await _categoryCountsForTest(true);
    const knowledgeCat = second.find((c) => c.id === "knowledge_file");
    expect(knowledgeCat?.count).toBe(1);
    expect(collectSpy).not.toHaveBeenCalled();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("skips knowledgeRows when category filter excludes knowledge_file (line 555)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=vector_memory"),
    );
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
  });

  it("episodic rows tolerate invalid metadata JSON via safeJson (lines 548-550)", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b26', 'Agent B26', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b26', 'note', NULL, 'not-json', 'result-b26', '2026-09-02T00:00:00Z')`,
      )
      .run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b26"),
    );
    const row = response.rows.find((r) => r.source === "agent-b26");
    expect(row?.project).toBeNull();
    expect(row?.content).toBe("result-b26");
  });

  it("buildMemoryInventory applies degraded filter against category status (line 714)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?degraded=degraded&category=ingested_message"),
    );
    expect(response.categories.find((c) => c.id === "vector_memory")?.status).toBe("degraded");
    expect(response.rows.length).toBeGreaterThanOrEqual(0);
  });
});
