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

const neo4jHttpQuery = vi.fn(async () => ({
  results: [{ data: [{ row: [null] }, "skip", { row: [5] }] }],
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
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch23 — deferred knowledge, filters, parseCount edges", () => {
  it("_categoryCountsForTest(false) defers knowledge counts with warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { _categoryCountsForTest, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const categories = await _categoryCountsForTest(false);
    const knowledge = categories.find((c) => c.id === "knowledge_file");
    expect(knowledge?.count).toBeNull();
    expect(knowledge?.warnings).toContain("Knowledge file count deferred until selected");
    expect(knowledge?.status).toBe("degraded");
  });

  it("getKnowledgeCategory cache hit returns cloned category within TTL", async () => {
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "120000");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b23-${crypto.randomUUID()}-`));
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({ collections: [{ name: "col-b23", category: "skills", basePath: tmp }] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "one.md"), "# one\n", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "collections.config.json"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
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

  it("parseCount skips invalid Neo4j row entries and nested array misses", async () => {
    neo4jHttpQuery.mockResolvedValueOnce({
      results: [{ data: [{ row: [7] }] }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [{ foo: 1 }, { bar: 2 }],
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(response.categories.find((c) => c.id === "graph_fact")?.count).toBe(7);
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.warnings.length).toBeGreaterThan(0);
  });

  it("matchesRowFilters agent and security label filters episodic rows", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b23', 'Agent B23', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b23', 'note', ?, ?, 'ok', '2026-08-15T00:00:00Z')`,
      )
      .run("d".repeat(64), JSON.stringify({ project: "proj-b23", domain: "ops" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const missAgent = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=other-agent"),
    );
    expect(missAgent.rows.length).toBe(0);

    const missLabel = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&label=confidential"),
    );
    expect(missLabel.rows.length).toBe(0);

    const hit = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b23&project=proj-b23"),
    );
    expect(hit.rows.some((row) => row.source === "agent-b23")).toBe(true);
  });

  it("matchesRowFilters label filter on ingested_message rows", async () => {
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b23', 'agent-b23-msg', 'user', 'row', '2026-04-01T00:00:00Z', 'internal', 'finance', 'indexable', 1)`,
      )
      .run(`sess-${crypto.randomUUID()}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const missLabel = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message&label=payment"),
    );
    expect(missLabel.rows.length).toBe(0);
    const hitLabel = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message&label=finance"),
    );
    expect(hitLabel.rows.some((row) => row.category === "ingested_message")).toBe(true);
  });

  it("degraded filter keeps rows whose category status is degraded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory?degraded=degraded"));
    expect(
      response.rows.every(
        (row) => response.categories.find((c) => c.id === row.category)?.status === "degraded",
      ),
    ).toBe(true);
  });

  it("safeJson returns {} for corrupt episodic metadata", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b23-bad', 'Agent', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b23-bad', 'note', ?, 'not-json', 'ok', '2026-08-15T00:00:00Z')`,
      )
      .run("e".repeat(64));
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
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b23-bad"),
    );
    expect(response.rows.some((row) => row.source === "agent-b23-bad")).toBe(true);
  });
});
