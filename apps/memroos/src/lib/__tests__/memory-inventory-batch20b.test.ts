// @vitest-environment node
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [0] }] }] }));
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
  neo4jHttpQuery.mockClear();
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch20b — row filters and null-count edges", () => {
  it("matchesRowFilters honors label and consolidationState query params", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b20b', 'agent-b20b', 'user', 'row', '2026-06-10T00:00:00Z', 'internal', 'engineering', 'indexable', 1)`,
      )
      .run(sessionId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const filteredOut = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?label=public&consolidationState=pending"),
    );
    expect(filteredOut.rows.length).toBe(0);

    const filteredIn = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?label=internal&consolidationState=consolidated"),
    );
    expect(filteredIn.rows.some((row) => row.source === "agent-b20b")).toBe(true);
  });

  it("graph category reports unavailable count when Neo4j returns unparseable payload without throwing", async () => {
    neo4jHttpQuery.mockResolvedValueOnce({ unexpected: true });
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
    expect(graph?.count).toBeNull();
    expect(graph?.metric.status).toBe("error");
    expect(graph?.warnings.some((w) => w.includes("unavailable"))).toBe(true);
  });
});
