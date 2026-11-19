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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [null] }] }], errors: [] as unknown[] }));
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
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch24 — status, timestamps, cache, filters", () => {
  it("marks deferred knowledge categories degraded when count is null with warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const knowledge = categories.find((c) => c.id === "knowledge_file");
    expect(knowledge?.count).toBeNull();
    expect(knowledge?.warnings.length).toBeGreaterThan(0);
    expect(knowledge?.status).toBe("degraded");
  });

  it("vector health ignores non-object JSON bodies for timestamp extraction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => null })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const vector = categories.find((c) => c.id === "vector_memory");
    expect(vector?.lastUpdated).toBeNull();
    expect(vector?.warnings.length).toBeGreaterThan(0);
  });

  it("graph category reports empty status when Neo4j count is zero", async () => {
    neo4jHttpQuery.mockResolvedValueOnce({ results: [{ data: [{ row: [0] }] }], errors: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const graph = categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBe(0);
    expect(graph?.status).toBe("empty");
  });

  it("getKnowledgeCategory cache hit returns a cloned category within TTL", async () => {
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "120000");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b24-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "col-b24", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "one.md"), "# one\n", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const first = await _categoryCountsForTest(true);
    const second = await _categoryCountsForTest(true);
    const k1 = first.find((c) => c.id === "knowledge_file");
    const k2 = second.find((c) => c.id === "knowledge_file");
    expect(k2?.count).toBe(k1?.count);
    expect(k2).not.toBe(k1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("buildMemoryInventory skips knowledge rows when category filter excludes knowledge_file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write"),
    );
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
  });
});
