// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDb = new Database(":memory:");
const knowledgeDir = mkdtempSync(path.join(tmpdir(), "memroos-lib-inventory-"));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/knowledge-collections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/knowledge-collections")>(
    "@/lib/knowledge-collections"
  );
  return {
    ...actual,
    loadCollections: () => [{ name: "ops", category: "business", basePath: knowledgeDir }],
  };
});

const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

afterAll(() => {
  testDb.close();
  rmSync(knowledgeDir, { recursive: true, force: true });
});

function seedMessage(content: string, consolidated = 0) {
  return testDb
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated, visibility, domain, sensitivity, policy)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      "sess-inv",
      "memroos",
      "codex",
      "assistant",
      content,
      "2026-05-24T12:00:00Z",
      consolidated,
      "internal",
      "product",
      "normal",
      "indexable"
    ).lastInsertRowid as number;
}

describe("buildMemoryInventory", () => {
  beforeEach(() => {
    vi.resetModules();
    testDb.exec("DELETE FROM messages");
    testDb.exec("DELETE FROM memory_meta_insights");
    testDb.exec("DELETE FROM memory_consolidation_runs");
    testDb.exec("DELETE FROM agent_memory_writes");
    testDb.exec("DELETE FROM registered_agents");
    delete process.env.MEMORY_INVENTORY_CATEGORY_TTL_MS;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          memory_count: 4,
          last_write: "2026-05-24T10:00:00Z",
        }),
      })
    );
  });

  it("returns category counts and ingested message rows", async () => {
    seedMessage("inventory alpha");
    seedMessage("inventory beta", 1);
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message")
    );
    expect(response.categories.some((c) => c.id === "ingested_message")).toBe(true);
    expect(response.rows.length).toBeGreaterThanOrEqual(2);
    expect(response.rows.every((r) => r.category === "ingested_message")).toBe(true);
    expect(response.filters.backends.length).toBeGreaterThan(0);
  });

  it("includes consolidated insights and episodic writes when unfiltered", async () => {
    testDb
      .prepare(
        `INSERT INTO memory_consolidation_runs(id, status, started_at, completed_at)
         VALUES (?, 'completed', ?, ?)`
      )
      .run(1, "2026-05-24T10:00:00Z", "2026-05-24T10:30:00Z");
    testDb
      .prepare(
        `INSERT INTO memory_meta_insights(run_id, insight_type, content, source_ids, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(1, "pattern", "insight body", "[]", "2026-05-24T11:00:00Z");
    testDb
      .prepare(
        `INSERT INTO registered_agents(id, name, role, platform, protocol, status, location)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("agent-1", "Agent One", "operator", "local", "rest", "active", "local");
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes(agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("agent-1", "lesson", "hash-1", '{"project":"p1"}', "ok", "2026-05-24T11:30:00Z");

    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(response.rows.some((r) => r.category === "consolidated_insight")).toBe(true);
    expect(response.rows.some((r) => r.category === "episodic_write")).toBe(true);
  });

  it("loads knowledge file rows when category=knowledge_file", async () => {
    writeFileSync(path.join(knowledgeDir, "note.md"), "# Inventory note\n", "utf8");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file")
    );
    const knowledge = response.categories.find((c) => c.id === "knowledge_file");
    expect(knowledge?.count).toBeGreaterThanOrEqual(1);
    expect(response.rows.some((r) => r.category === "knowledge_file")).toBe(true);
  });

  it("marks vector category degraded when mem0 health fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("mem0 down"))
    );
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.status).toBe("degraded");
    expect(vector?.warnings.length).toBeGreaterThan(0);
  });

  it("filters rows by project and consolidation state", async () => {
    seedMessage("project filter target");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?category=ingested_message&project=memroos&consolidationState=pending"
      )
    );
    expect(response.rows.every((r) => r.project === "memroos")).toBe(true);
    expect(response.rows.every((r) => r.consolidationState === "pending")).toBe(true);
  });

  it("marks graph category unavailable when Neo4j password is missing", async () => {
    const prev = process.env.NEO4J_PASSWORD;
    delete process.env.NEO4J_PASSWORD;
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.status).toBe("degraded");
    expect(graph?.warnings.some((w) => /password/i.test(w))).toBe(true);
    if (prev !== undefined) process.env.NEO4J_PASSWORD = prev;
  });

  it("parses nested vector counts from mem0 health payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          vector: { count: 12 },
          last_updated: "2026-05-24T09:00:00Z",
        }),
      })
    );
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(12);
    expect(vector?.status).toBe("live");
  });

  it("filters rows by security label and degraded category status", async () => {
    seedMessage("label filter alpha");
    testDb
      .prepare(`UPDATE messages SET sensitivity = ? WHERE content = ?`)
      .run("payment", "label filter alpha");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?category=ingested_message&label=payment&degraded=live"
      )
    );
    expect(response.rows.every((r) => r.securityLabel.sensitivity === "payment")).toBe(true);
  });

  it("reuses cached category counts within MEMORY_INVENTORY_CATEGORY_TTL_MS", async () => {
    process.env.MEMORY_INVENTORY_CATEGORY_TTL_MS = "60000";
    const { buildMemoryInventory } = await import("../memory-inventory");
    const firstCount = (
      await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"))
    ).categories.find((c) => c.id === "ingested_message")?.count;
    seedMessage("after cache warm");
    const secondCount = (
      await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"))
    ).categories.find((c) => c.id === "ingested_message")?.count;
    expect(secondCount).toBe(firstCount);
  });

  it("returns empty metric envelope for empty sqlite categories without observations", async () => {
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const writes = response.categories.find((c) => c.id === "episodic_write");
    expect(writes?.count).toBe(0);
    // Healthy source + zero rows + no latestAt → empty (not measured-zero).
    expect(writes?.metric.status).toBe("empty");
  });

  it("filters by backend, source, date range, and degraded category status", async () => {
    seedMessage("backend filter row");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?category=ingested_message&backend=sqlite&source=codex&dateFrom=2026-05-24T00:00:00Z&dateTo=2026-05-25T00:00:00Z&degraded=live"
      )
    );
    expect(response.rows.every((r) => r.backend === "sqlite")).toBe(true);
    expect(response.rows.every((r) => r.source === "codex")).toBe(true);
  });

  it("ignores knowledge_file rows when another category filter is active", async () => {
    writeFileSync(path.join(knowledgeDir, "filtered.md"), "# filtered\n", "utf8");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message")
    );
    expect(response.rows.every((r) => r.category === "ingested_message")).toBe(true);
    expect(response.rows.some((r) => r.category === "knowledge_file")).toBe(false);
  });

  it("parses Neo4j transactional count payloads for graph_fact category", async () => {
    const prev = process.env.NEO4J_PASSWORD;
    process.env.NEO4J_PASSWORD = "test-graph-pass";
    vi.doMock("@/lib/memory/backends", async () => {
      const actual = await vi.importActual<typeof import("@/lib/memory/backends")>(
        "@/lib/memory/backends"
      );
      return {
        ...actual,
        neo4jHttpQuery: vi.fn(async () => ({
          results: [{ data: [{ row: [17] }] }],
          errors: [],
        })),
      };
    });
    vi.resetModules();
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBe(17);
    expect(graph?.status).toBe("live");
    if (prev === undefined) delete process.env.NEO4J_PASSWORD;
    else process.env.NEO4J_PASSWORD = prev;
    vi.doUnmock("@/lib/memory/backends");
    vi.resetModules();
  });

  it("warns when mem0 reports connected vector store without a count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          vector_store: "connected",
        }),
      })
    );
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.warnings.some((w) => /memory_count|points_count/i.test(w))).toBe(true);
  });

  it("filters ingested_message rows by agent source alias", async () => {
    seedMessage("agent filter hit");
    testDb.prepare(`UPDATE messages SET agent_id = ? WHERE content = ?`).run("research-bot", "agent filter hit");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message&agent=research-bot")
    );
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]?.source).toBe("research-bot");
  });

  it("parses malformed agent_memory_writes metadata as empty object", async () => {
    testDb
      .prepare(
        `INSERT INTO registered_agents(id, name, role, platform, protocol, status, location)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("agent-bad-meta", "Bad Meta", "operator", "local", "rest", "active", "local");
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes(agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("agent-bad-meta", "lesson", "hash-bad", "not-json", "ok", "2026-05-24T12:00:00Z");
    const { buildMemoryInventory } = await import("../memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const row = response.rows.find((r) => r.category === "episodic_write" && r.source === "agent-bad-meta");
    expect(row).toBeTruthy();
    expect(row?.project).toBeNull();
  });
});
