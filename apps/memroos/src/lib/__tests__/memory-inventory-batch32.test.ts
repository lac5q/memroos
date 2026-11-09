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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [3] }] }], errors: [] as unknown[] }));
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

describe("memory-inventory batch32 — knowledge cache TTL and deferred category", () => {
  // sticky: countStatus(null, []) line 162 and category unavailable metric line 345 — no production caller passes null count without warnings.

  it("getKnowledgeCategory reuses cached category within TTL (line 621)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b32-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b32", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "note-b32.md"), "# batch32 knowledge", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "120000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );

    const knowledge = await import("@/lib/knowledge-collections");
    const collectSpy = vi.spyOn(knowledge, "collectCollectionFiles");
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");

    _resetMemoryInventoryCacheForTest();
    const first = await _categoryCountsForTest(true);
    expect(first.find((c) => c.id === "knowledge_file")?.count).toBeGreaterThan(0);
    collectSpy.mockClear();

    const second = await _categoryCountsForTest(true);
    expect(collectSpy).not.toHaveBeenCalled();
    expect(second.find((c) => c.id === "knowledge_file")?.warnings).toEqual(
      first.find((c) => c.id === "knowledge_file")?.warnings,
    );

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("defers knowledge_file counts when categoryCounts skips filesystem wait (line 625)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const row = categories.find((c) => c.id === "knowledge_file");
    expect(row?.count).toBeNull();
    expect(row?.warnings.some((w) => w.includes("deferred"))).toBe(true);
  });
});
