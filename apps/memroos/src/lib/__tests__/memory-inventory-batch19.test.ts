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

const neo4jHttpQuery = vi.fn(async () => ({ results: [{ data: [{ row: [1] }] }] }));
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

describe("memory-inventory batch19 — episodic rows, degraded filter, dateTo", () => {
  it("includes episodic_write rows and tolerates malformed metadata JSON", async () => {
    testDb
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
         VALUES ('agent-b19', 'Agent B19', 'worker', 'memroos', 'rest', 'active', 'local')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO agent_memory_writes
          (agent_id, memory_type, content_hash, metadata, result, written_at)
         VALUES ('agent-b19', 'note', ?, 'not-json', 'ok', '2026-06-11T00:00:00Z')`,
      )
      .run("d".repeat(64));
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
      new URL("http://localhost/api/memory-inventory?category=episodic_write&agent=agent-b19"),
    );
    expect(response.rows.some((row) => row.category === "episodic_write")).toBe(true);
  });

  it("matchesRowFilters rejects rows when dateTo is before the row timestamp", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy, consolidated)
         VALUES (?, 'proj-b19', 'agent-b19', 'user', 'row', '2026-06-10T00:00:00Z', 'internal', 'engineering', 'indexable', 1)`,
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
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-b19&dateTo=2026-01-01T00:00:00Z"),
    );
    expect(response.rows.length).toBe(0);
  });

  it("degraded filter keeps only rows whose category status matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory?degraded=degraded"));
    expect(response.rows.every((row) => response.categories.find((c) => c.id === row.category)?.status === "degraded")).toBe(
      true,
    );
  });

  it("knowledge rows appear when category=knowledge_file and collections exist", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b19-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "skills");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Skill note\n", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "skills-col", category: "skills", basePath: "skills" }],
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
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file"),
    );
    expect(response.rows.some((row) => row.category === "knowledge_file")).toBe(true);
  });
});
