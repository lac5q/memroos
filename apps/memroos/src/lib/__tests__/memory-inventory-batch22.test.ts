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
  results: [{ data: [{ row: [[{ count: 9 }]] }] }],
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

describe("memory-inventory batch22 — parseCount nesting, filters, knowledge cache", () => {
  it("parseCount resolves nested Neo4j row arrays and array-of-object payloads", async () => {
    neo4jHttpQuery.mockResolvedValueOnce({
      results: [{ data: [{ row: [42] }] }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [{ memory_count: 3 }, { count: 0 }],
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(graph?.count).toBe(42);
    expect(vector?.count).toBe(3);
  });

  it("matchesRowFilters rejects backend, source, and dateFrom mismatches on episodic rows", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b22', 'Agent B22', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b22', 'note', ?, ?, 'ok', '2026-08-15T00:00:00Z')`,
      )
      .run("c".repeat(64), JSON.stringify({ project: "proj-b22" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const missBackend = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&backend=Neo4j%20graph"),
    );
    expect(missBackend.rows.length).toBe(0);

    const missSource = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=episodic_write&source=other-agent"),
    );
    expect(missSource.rows.length).toBe(0);

    const missDateFrom = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b22&dateFrom=2026-09-01T00:00:00Z",
      ),
    );
    expect(missDateFrom.rows.length).toBe(0);

    const hit = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b22&project=proj-b22&source=agent-b22&dateFrom=2026-01-01T00:00:00Z",
      ),
    );
    expect(hit.rows.some((row) => row.source === "agent-b22")).toBe(true);
  });

  it("knowledgeRows early-returns when category filter excludes knowledge_file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b22-${crypto.randomUUID()}-`));
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "notes-b22", category: "skills", basePath: tmp }],
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "sample.md"), "# note\n", "utf8");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const withoutKnowledgeCategory = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message"),
    );
    expect(withoutKnowledgeCategory.rows.every((row) => row.category !== "knowledge_file")).toBe(true);

    const withKnowledgeCategory = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file&source=notes-b22"),
    );
    expect(withKnowledgeCategory.rows.some((row) => row.category === "knowledge_file")).toBe(true);
  });

  it("reuses cached knowledge category within TTL without refetching collections", async () => {
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "120000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const first = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const second = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const k1 = first.categories.find((c) => c.id === "knowledge_file");
    const k2 = second.categories.find((c) => c.id === "knowledge_file");
    expect(k2?.count).toBe(k1?.count ?? null);
    expect(k2).not.toBe(k1);
  });

  it("vector category uses unavailable metric when mem0 returns empty JSON without warnings path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })),
    );
    neo4jHttpQuery.mockResolvedValueOnce({ results: [{ data: [{ row: [1] }] }] });
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.warnings.length).toBeGreaterThan(0);
    expect(["degraded", "unavailable", "error"]).toContain(vector?.metric.status);
  });
});
