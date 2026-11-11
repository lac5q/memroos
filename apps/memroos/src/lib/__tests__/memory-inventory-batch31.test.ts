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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [7] }] }], errors: [] as unknown[] }));
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

describe("memory-inventory batch31 — inventory branches", () => {
  it.skip("category(null,[]) unavailable metric — private category() has no public API (lines 162, 345)", () => {
    // Cannot reach countStatus(null, []) or metric unavailable-without-warnings without exporting helpers.
  });

  it("graph_fact category reports live count with empty warnings when neo4j returns a number", async () => {
    neo4jHttpQuery.mockResolvedValueOnce({ results: [{ data: [{ row: [12] }] }], errors: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const graph = categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBe(12);
    expect(graph?.warnings).toEqual([]);
    expect(graph?.status).toBe("live");
  });

  it("knowledgeRows returns early for non-knowledge category filter (line 555)", async () => {
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

  it("reuses inflight knowledge scan within TTL window (line 621)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b31-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b31", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "note-b31.md"), "# batch31", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "120000");

    const knowledge = await import("@/lib/knowledge-collections");
    const collectSpy = vi.spyOn(knowledge, "collectCollectionFiles");

    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    await _categoryCountsForTest(true);
    collectSpy.mockClear();
    const second = await _categoryCountsForTest(true);
    expect(collectSpy).not.toHaveBeenCalled();
    expect(second.find((c) => c.id === "knowledge_file")?.count).toBeGreaterThan(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
