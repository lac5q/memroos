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
const neo4jConfig = vi.fn(() => ({ password: "test-neo4j", url: "http://localhost:7474" }));

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

describe("memory-inventory batch27 — graph unavailable metric, knowledge cache, row filters", () => {
  it("returns knowledge category from cache on second fetch within TTL (line 621)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b27-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b27", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "sample-b27.md"), "# note", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "900000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );

    const knowledge = await import("@/lib/knowledge-collections");
    const collectSpy = vi.spyOn(knowledge, "collectCollectionFiles");

    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const first = await _categoryCountsForTest(true);
    expect(first.find((c) => c.id === "knowledge_file")?.count).toBe(1);
    collectSpy.mockClear();
    const second = await _categoryCountsForTest(true);
    expect(second.find((c) => c.id === "knowledge_file")?.count).toBe(1);
    expect(collectSpy).not.toHaveBeenCalled();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("knowledgeRows returns empty when category filter excludes knowledge_file (line 555)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=consolidated_insight"),
    );
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
  });

  it("vector category uses degraded countStatus when mem0 returns no count (line 162 warning branch)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ vector_store: "connected" }),
      })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const vector = categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.status).toBe("degraded");
    expect(vector?.metric.reason).toMatch(/missing|unavailable/i);
  });
});
