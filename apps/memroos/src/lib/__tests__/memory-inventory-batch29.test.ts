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

const neo4jHttpQuery = vi.fn(async () => ({
  results: [{ data: [{ row: [9] }] }],
  errors: [] as unknown[],
}));
const neo4jConfig = vi.fn(() => ({ password: "secret", url: "http://localhost:7474" }));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => neo4jConfig(),
  neo4jHttpQuery: (...args: unknown[]) => neo4jHttpQuery(...args),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  testDb.exec("DELETE FROM messages");
  testDb.exec("DELETE FROM agent_memory_writes");
  testDb.exec("DELETE FROM memory_meta_insights");
  neo4jHttpQuery.mockClear();
  neo4jConfig.mockReset();
  neo4jConfig.mockReturnValue({ password: "secret", url: "http://localhost:7474" });
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch29 — safeJson, unavailable metric, knowledge defer", () => {
  it("episodic_write uses row.result when metadata JSON is invalid (safeJson line 549 → content line 522)", async () => {
    const agentId = `agent-b29-${randomUUID().slice(0, 8)}`;
    const fallbackResult = `episodic-fallback-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES (?, 'E B29', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run(agentId);
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES (?, 'note', NULL, '{not-json', ?, '2026-10-01T00:00:00Z')`,
      )
      .run(agentId, fallbackResult);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ memory_count: 0 }),
      })),
    );

    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write"),
    );
    const episodic = response.rows.find((r) => r.category === "episodic_write");
    expect(episodic?.content).toBe(fallbackResult);
  });

  it("vector category with live row count formats reason with toLocaleString (lines 321-325)", async () => {
    const big = 2500 + (randomUUID().length % 50);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ memory_count: big }),
      })),
    );

    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.metric.reason).toContain(`${big.toLocaleString()} rows from`);
  });

  it("getKnowledgeCategory(waitForKnowledge false) returns deferred category (line 621)", async () => {
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );

    const { _resetMemoryInventoryCacheForTest, _categoryCountsForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const knowledge = categories.find((c) => c.id === "knowledge_file");
    expect(knowledge?.warnings.some((w) => w.includes("deferred"))).toBe(true);
  });

  it("knowledge_file rows use path.relative when HOME is set (knowledgeRows line 560)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b29-${randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    const noteName = `note-b29-${randomUUID().slice(0, 6)}.md`;
    fs.writeFileSync(path.join(collectionDir, noteName), "# Batch29", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b29", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );

    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file"),
    );
    const row = response.rows.find((r) => r.category === "knowledge_file" && r.content.includes("notes"));
    expect(row?.content).toMatch(/^notes\/|^notes\\/);

    process.env.HOME = prevHome;
  });
});
