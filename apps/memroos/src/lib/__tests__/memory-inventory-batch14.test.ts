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
    results: [{ data: [{ row: [3] }] }],
  })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  testDb.exec("DELETE FROM messages");
  testDb.exec("DELETE FROM agent_memory_writes");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch14 — parseCount, backends, and filters", () => {
  it("parses mem0 health vector counts and neo4j transactional responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ vector_store: "connected", memory_count: 7, last_write: "2026-01-01T00:00:00Z" }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(7);
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.count).toBe(3);
  });

  it("marks vector category degraded when mem0 health lacks counts", async () => {
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
    expect(vector?.warnings.some((w) => w.includes("HTTP 503"))).toBe(true);
  });

  it("filters rows by degraded category status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'proj', 'agent', 'user', ?, '2026-01-02T00:00:00Z', 'internal', 'indexable')`,
      )
      .run(`sess-${crypto.randomUUID()}`, "visible message");
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const degraded = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?degraded=degraded"),
    );
    expect(degraded.rows.every((r) => r.category === "ingested_message")).toBe(true);

    const liveOnly = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?degraded=live"),
    );
    expect(liveOnly.rows.every((r) => r.category === "ingested_message")).toBe(true);
  });

  it("applies knowledge_file row filters for backend and source", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b14-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "alpha.md"), "# Alpha", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "notes-alpha", category: "skills", basePath: "notes" }],
      }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.resetModules();
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const rows = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file&source=notes-alpha"),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.source === "notes-alpha")).toBe(true);
    vi.unstubAllEnvs();
  });
});
