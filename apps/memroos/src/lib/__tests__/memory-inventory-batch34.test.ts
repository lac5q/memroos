// @vitest-environment node
import { randomUUID } from "node:crypto";
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

describe("memory-inventory batch34 — knowledge deferral, cache, filters", () => {
  it.skip("countStatus(null, []) unavailable metric branch (162, 345) — no public API reaches private category()", () => {});

  it("knowledge category deferred when waitForKnowledge is false (621)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const knowledge = categories.find((c) => c.id === "knowledge_file");
    expect(knowledge?.warnings.some((w) => w.includes("deferred"))).toBe(true);
    expect(knowledge?.count).toBeNull();
  });

  it("knowledgeRows skipped when category filter is not knowledge_file (555)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-filter-b34-${randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b34", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "note-b34.md"), "# batch34", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory?category=message"));
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("buildMemoryInventory includes knowledge_file rows when category filter matches (555)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b34-${randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b34", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "note-b34.md"), "# batch34 inventory", "utf8");
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
