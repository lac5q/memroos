// @vitest-environment node
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const neo4jHttpQuery = vi.fn(async () => ({
  results: [{ data: [{ row: [3] }] }],
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
  neo4jHttpQuery.mockClear();
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch21 — lastUpdated classify path and knowledge cache", () => {
  it("vector category uses last_updated when mem0 health returns a countable payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          memory_count: 12,
          last_updated: "2026-10-28T08:00:00.000Z",
        }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(12);
    expect(vector?.metric.observedAt).toBe("2026-10-28T08:00:00.000Z");
  });

  it("vector category keeps measured count when mem0 health is non-OK but count is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ memory_count: 7, last_updated: "2026-10-28T09:00:00.000Z" }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(7);
    expect(vector?.warnings.some((w) => w.includes("503"))).toBe(true);
    expect(vector?.metric.reason).toMatch(/warnings/i);
  });

  it("knowledge category returns cached clone within MEMORY_INVENTORY_CATEGORY_TTL_MS", async () => {
    vi.stubEnv("MEMORY_INVENTORY_CATEGORY_TTL_MS", "60000");
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
    const firstKnowledge = first.categories.find((c) => c.id === "knowledge_file");
    const secondKnowledge = second.categories.find((c) => c.id === "knowledge_file");
    expect(secondKnowledge?.count).toBe(firstKnowledge?.count ?? null);
    expect(secondKnowledge).not.toBe(firstKnowledge);
  });
});
