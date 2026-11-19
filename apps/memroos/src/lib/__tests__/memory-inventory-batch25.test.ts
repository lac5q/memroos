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

describe("memory-inventory batch25 — vector connected, throws, episodic labels, knowledge errors", () => {
  it("vector category warns when store is connected but count fields are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ vector_store: "connected", status: "ok" }),
      })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const vector = categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.warnings.some((w) => w.includes("connected"))).toBe(true);
  });

  it("vector category uses default warning text for non-Error fetch failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "mem0 down batch25";
      }),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const vector = categories.find((c) => c.id === "vector_memory");
    expect(vector?.warnings.some((w) => w.includes("mem0 health unavailable"))).toBe(true);
  });

  it("graph category uses default warning text for non-Error neo4j failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 1 }) })),
    );
    neo4jHttpQuery.mockRejectedValueOnce("graph down batch25");
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const graph = categories.find((c) => c.id === "graph_fact");
    expect(graph?.warnings.some((w) => w.includes("Neo4j unavailable"))).toBe(true);
  });

  it("live vector count with HTTP warning keeps measured count and warning reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ count: 4, last_write: "2026-05-01T00:00:00.000Z" }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(4);
    expect(vector?.metric.reason).toContain("warnings");
    expect(vector?.warnings.some((w) => w.includes("503"))).toBe(true);
  });

  it("episodic rows use result content when memory_type and content_hash are absent", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b25', 'Agent B25', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b25', NULL, NULL, ?, 'plain-result-b25', '2026-09-01T00:00:00Z')`,
      )
      .run(JSON.stringify({ project: "proj-b25" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b25"),
    );
    const row = response.rows.find((r) => r.source === "agent-b25");
    expect(row?.label).toBe("Episodic write");
    expect(row?.content).toBe("plain-result-b25");
  });

  it("knowledge category records scan failures from collectCollectionFiles", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b25-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "notes-b25", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    vi.resetModules();
    const knowledge = await import("@/lib/knowledge-collections");
    vi.spyOn(knowledge, "collectCollectionFiles").mockImplementationOnce(async () => {
      throw new Error("scan failed batch25");
    });
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(true);
    const knowledgeCat = categories.find((c) => c.id === "knowledge_file");
    expect(knowledgeCat?.warnings.some((w) => w.includes("scan failed batch25"))).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("deferred knowledge path returns null count with defer warning when not waiting", async () => {
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

  it("filterOptions exposes project values from episodic rows", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b25-filters', 'Agent', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b25-filters', 'note', ?, ?, 'ok', '2026-08-20T00:00:00Z')`,
      )
      .run("d".repeat(64), JSON.stringify({ project: "proj-filter-b25" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b25-filters"),
    );
    expect(response.filters.projects).toContain("proj-filter-b25");
  });
});
