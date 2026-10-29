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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [3] }] }] }));
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
  neo4jHttpQuery.mockClear();
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch18 — parseCount, category unavailable, row filters", () => {
  it("parseCount recurses arrays and reads nested neo4j row counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [{ count: 2 }, { memory_count: 4 }],
      })),
    );
    neo4jHttpQuery.mockResolvedValueOnce({
      results: [{ data: [{ notRow: true }, { row: ["bad"] }, { row: [7] }] }],
    });
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(response.categories.find((c) => c.id === "vector_memory")?.count).toBe(2);
    expect(response.categories.find((c) => c.id === "graph_fact")?.count).toBe(7);
  });

  it("timestampFrom reads last_write from mem0 health payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0, last_write: "2026-02-02T08:00:00.000Z" }),
      })),
    );
    neo4jHttpQuery.mockResolvedValueOnce({ results: [{ data: [{ row: [0] }] }] });
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.lastUpdated).toBe("2026-02-02T08:00:00.000Z");
    expect(vector?.status).toBe("empty");
  });

  it("graphCategory catch surfaces neo4j errors as degraded warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 1 }),
      })),
    );
    neo4jHttpQuery.mockRejectedValueOnce(new Error("neo4j timeout"));
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.warnings.some((w) => w.includes("neo4j timeout"))).toBe(true);
  });

  it("matchesRowFilters applies agent, project, source, dateTo, and label filters", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b18', 'agent-b18', 'user', 'row', '2026-04-10T00:00:00Z', 'internal', 'engineering', 'indexable', 1)`,
      )
      .run(sessionId);
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const missAgent = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=other-agent&project=proj-b18"),
    );
    expect(missAgent.rows.length).toBe(0);

    const missProject = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b18&project=other-project"),
    );
    expect(missProject.rows.length).toBe(0);

    const missDateTo = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b18&dateTo=2026-04-01T00:00:00Z"),
    );
    expect(missDateTo.rows.length).toBe(0);

    const missSource = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b18&source=wrong-source"),
    );
    expect(missSource.rows.length).toBe(0);
  });

  it("knowledge category cache returns cloned counts on repeat calls within TTL", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b18-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b18", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "600000");

    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const first = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const second = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(second.categories.find((c) => c.id === "knowledge_file")?.count).toBe(
      first.categories.find((c) => c.id === "knowledge_file")?.count ?? null,
    );
    expect((first.categories.find((c) => c.id === "knowledge_file")?.count ?? 0) > 0).toBe(true);
  });

  it("knowledgeRows returns empty when category filter excludes knowledge_file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b18f-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b18f", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=vector_memory"),
    );
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
  });
});
