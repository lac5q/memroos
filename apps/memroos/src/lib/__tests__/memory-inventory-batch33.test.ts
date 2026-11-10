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
  testDb.exec("DELETE FROM messages");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch33 — knowledge rows and scan warnings", () => {
  it.skip("countStatus(null, []) and unavailable metric without warnings (162, 345) — no public API reaches private category()", () => {
    // Sticky: category() null count without warnings is only reachable from private helpers.
  });

  it("buildMemoryInventory includes knowledge_file rows when category filter is set (555)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b33-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b33", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "note-b33.md"), "# batch33 knowledge inventory", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );

    const { buildMemoryInventory, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory?category=knowledge_file"));
    expect(response.rows.some((row) => row.category === "knowledge_file")).toBe(true);
    expect(response.rows[0]?.content).toContain("note-b33.md");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("knowledge category cache TTL reuse path (621)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-cache-b33-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "cache-b33", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "cached-b33.md"), "# cache", "utf8");
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
    await _categoryCountsForTest(true);
    collectSpy.mockClear();
    const second = await _categoryCountsForTest(true);
    expect(collectSpy).not.toHaveBeenCalled();
    expect(second.find((c) => c.id === "knowledge_file")?.count).toBeGreaterThan(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("knowledge category records scan warnings when collection enumeration fails", async () => {
    const knowledge = await import("@/lib/knowledge-collections");
    vi.spyOn(knowledge, "loadCollections").mockReturnValue([
      { name: "broken-b33", category: "skills", basePath: path.join(os.tmpdir(), `missing-b33-${crypto.randomUUID()}`) },
    ]);
    vi.spyOn(knowledge, "collectCollectionFiles").mockRejectedValue(new Error("scan failed batch33"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const knowledgeRow = categories.find((c) => c.id === "knowledge_file");
    expect(knowledgeRow?.warnings.some((w) => w.includes("scan failed batch33"))).toBe(true);
    expect(knowledgeRow?.status).not.toBe("live");
  });
});
