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

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const neo4jHttpQuery = vi.fn(async () => ({
  results: [
    null,
    { data: "not-an-array" },
    { data: [{ notRow: true }] },
    { data: [{ row: [9] }] },
  ],
}));

vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => ({ password: "secret", url: "http://localhost:7474" }),
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

describe("memory-inventory batch16 — parseCount edges and row filters", () => {
  it("parseCount recurses nested arrays and reads last_updated from health JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          stats: [[{ count: 6 }]],
          last_updated: "2026-03-01T12:00:00.000Z",
        }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(6);
    expect(vector?.lastUpdated).toBe("2026-03-01T12:00:00.000Z");
  });

  it("tolerates mem0 health JSON parse failures and marks graph unavailable without count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json");
        },
      })),
    );
    neo4jHttpQuery.mockResolvedValueOnce({});
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBeNull();
    expect((graph?.warnings ?? []).some((w) => w.includes("unavailable"))).toBe(true);
  });

  it("matchesRowFilters rejects rows when label and backend filters miss", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b16', 'agent-b16', 'user', 'row', '2026-04-01T00:00:00Z', 'internal', 'engineering', 'indexable', 1)`,
      )
      .run(sessionId);
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const missLabel = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?backend=SQLite%20messages&agent=agent-b16&project=proj-b16&source=agent-b16&label=payment",
      ),
    );
    expect(missLabel.rows.length).toBe(0);

    const missBackend = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?backend=Neo4j%20graph&agent=agent-b16"),
    );
    expect(missBackend.rows.length).toBe(0);
  });

  it("knowledgeCategory surfaces scan warnings and knowledge cache hits on repeat calls", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b16-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b16", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "600000");
    vi.resetModules();

    const knowledge = await import("@/lib/knowledge-collections");
    vi.spyOn(knowledge, "collectCollectionFiles").mockImplementationOnce(async () => {
      throw new Error("scan failed for test");
    });

    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const first = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const knowledgeCat = first.categories.find((c) => c.id === "knowledge_file");
    expect((knowledgeCat?.warnings ?? []).some((w) => w.includes("scan failed"))).toBe(true);

    const second = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(second.categories.find((c) => c.id === "knowledge_file")?.count).toBe(
      knowledgeCat?.count ?? null,
    );
  });

  it("filters knowledge_file rows by project/source when category is knowledge_file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b16f-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-filter", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.resetModules();
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const rows = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file&project=missing-project"),
    );
    expect(rows.rows.length).toBe(0);
  });
});
