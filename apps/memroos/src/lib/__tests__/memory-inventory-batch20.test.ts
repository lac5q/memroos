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
  results: [{ data: [{ row: [42] }] }],
  errors: [] as unknown[],
}));
const neo4jConfig = vi.fn(() => ({ password: "secret", url: "http://localhost:7474" }));

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
  neo4jHttpQuery.mockClear();
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch20 — parseCount, filters, and category edges", () => {
  it("graph category parses Neo4j transactional count shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBe(42);
  });

  it("vector category warns when mem0 is connected but count fields are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ vector_store: "connected" }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.warnings.some((w) => w.includes("memory_count"))).toBe(true);
  });

  it("parseCount unwraps nested array payloads from upstream health responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ stats: [{ memory_count: 9 }] }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(9);
  });

  it("knowledge_file rows appear when collections are configured on disk", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b20-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "skills");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Skill note\n", "utf8");
    fs.writeFileSync(
      path.join(tmp, "collections.config.json"),
      JSON.stringify({
        collections: [{ name: "skills-col", category: "skills", basePath: "skills" }],
      }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
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
    expect(response.rows.some((row) => row.category === "knowledge_file")).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
