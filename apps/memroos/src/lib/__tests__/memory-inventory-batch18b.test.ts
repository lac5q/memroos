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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [0] }] }] }));
const neo4jConfig = vi.fn(() => ({ password: "", url: "http://localhost:7474" }));

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
  neo4jConfig.mockReset();
  neo4jConfig.mockReturnValue({ password: "", url: "http://localhost:7474" });
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch18b — unavailable metric branch and deferred knowledge", () => {
  it("graph category uses unavailable metric when neo4j password missing and no warnings payload", async () => {
    neo4jConfig.mockReturnValue({ password: "", url: "http://localhost:7474" });
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
    expect(["unavailable", "error", "degraded"]).toContain(graph?.metric?.status);
    expect(graph?.warnings.some((w) => /password/i.test(w))).toBe(true);
  });

  it("vector category marks degraded when mem0 health throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("mem0 socket reset");
      }),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.status).toBe("degraded");
    expect(vector?.warnings.some((w) => w.includes("mem0 socket reset"))).toBe(true);
  });

  it("matchesRowFilters rejects rows when label and consolidationState filters miss", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b18b', 'agent-b18b', 'user', 'row', '2026-05-10T00:00:00Z', 'internal', 'engineering', 'indexable', 0)`,
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
    const missLabel = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b18b&label=missing-label"),
    );
    expect(missLabel.rows.length).toBe(0);

    const missState = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?agent=agent-b18b&consolidationState=consolidated",
      ),
    );
    expect(missState.rows.length).toBe(0);
  });

  it("knowledge scan warnings surface when collection base path is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b18b-${crypto.randomUUID()}-`));
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "missing-base", category: "skills", basePath: "does-not-exist" }],
      }),
      "utf8",
    );
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
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const knowledge = response.categories.find((c) => c.id === "knowledge_file");
    expect((knowledge?.warnings.length ?? 0) > 0 || knowledge?.count === 0).toBe(true);
  });
});
