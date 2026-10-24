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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [0] }] }] }));

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
  neo4jHttpQuery.mockClear();
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch17 — status edges and filter branches", () => {
  it("marks vector category degraded when count is null but warnings exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.status).toBe("degraded");
    expect((vector?.warnings ?? []).length).toBeGreaterThan(0);
  });

  it("marks ingested_message empty when sqlite count is zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    neo4jHttpQuery.mockResolvedValueOnce({ results: [{ data: [{ row: [0] }] }] });
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const ingested = response.categories.find((c) => c.id === "ingested_message");
    expect(ingested?.count).toBe(0);
    expect(ingested?.status).toBe("empty");
  });

  it("marks graph degraded when Neo4j password is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 1 }),
      })),
    );
    neo4jConfig.mockReturnValueOnce({ password: "", url: "http://localhost:7474" });
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBeNull();
    expect((graph?.warnings ?? []).some((w) => w.includes("password"))).toBe(true);
  });

  it("matchesRowFilters applies date, label, and consolidation filters", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b17', 'agent-b17', 'user', 'row', '2026-04-15T00:00:00Z', 'internal', 'engineering', 'indexable', 1)`,
      )
      .run(sessionId);
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const outOfRange = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?agent=agent-b17&project=proj-b17&dateFrom=2026-05-01T00:00:00Z",
      ),
    );
    expect(outOfRange.rows.length).toBe(0);

    const labelMiss = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b17&label=payment"),
    );
    expect(labelMiss.rows.length).toBe(0);

    const stateMiss = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b17&consolidationState=pending"),
    );
    expect(stateMiss.rows.length).toBe(0);
  });

  it("knowledgeRows returns empty when category filter excludes knowledge_file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b17-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b17", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.resetModules();
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=vector_memory"),
    );
    expect(response.rows.every((row) => row.category !== "knowledge_file")).toBe(true);
  });
});
