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

vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => ({ password: "secret", url: "http://localhost:7474" }),
  neo4jHttpQuery: vi.fn(async () => ({
    results: [{ data: [{ row: [12] }] }],
  })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  testDb.exec("DELETE FROM messages");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch14c — parseCount, filters, knowledge defer", () => {
  it("parseCount reads Neo4j transactional row arrays from graph health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/health")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ vector_store: "connected" }),
          };
        }
        return { ok: false, status: 503, json: async () => ({}) };
      }),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBe(12);
  });

  it("matchesRowFilters applies dateFrom/dateTo and consolidationState", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy, consolidated)
         VALUES (?, 'proj-a', 'agent-a', 'user', 'dated row', '2026-02-10T00:00:00Z', 'internal', 'indexable', 0)`,
      )
      .run(sessionId);
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const inRange = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?dateFrom=2026-02-01T00:00:00Z&dateTo=2026-02-28T00:00:00Z&consolidationState=pending",
      ),
    );
    expect(inRange.rows.some((r) => r.consolidationState === "pending")).toBe(true);

    const outOfRange = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?dateFrom=2026-03-01T00:00:00Z"),
    );
    expect(outOfRange.rows.length).toBe(0);
  });

  it("defers knowledge file rows unless category=knowledge_file is selected", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b14c-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b14c", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.resetModules();
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const withoutCategory = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(withoutCategory.rows.every((r) => r.category !== "knowledge_file")).toBe(true);

    const withCategory = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file"),
    );
    expect(withCategory.rows.some((r) => r.category === "knowledge_file")).toBe(true);
  });

  it("marks vector category degraded when mem0 health lacks counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ vector_store: "connected", nested: [{ foo: "bar" }] }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.status).toBe("degraded");
    expect((vector?.warnings ?? []).length).toBeGreaterThan(0);
  });
});
