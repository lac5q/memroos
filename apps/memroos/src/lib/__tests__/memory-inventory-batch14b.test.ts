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
  neo4jConfig: () => ({ password: "", url: "http://localhost:7474" }),
  neo4jHttpQuery: vi.fn(async () => ({ results: [] })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  testDb.exec("DELETE FROM messages");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch14b — parseCount arrays, filters, knowledge defer", () => {
  it("parseCount walks nested arrays from mem0 health payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ vector_store: "connected", memory_count: 4, nested: [{ count: 99 }] }),
      })),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(4);
  });

  it("matchesRowFilters honors agent and project query params", async () => {
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'proj-a', 'agent-a', 'user', ?, '2026-01-05T00:00:00Z', 'internal', 'indexable')`,
      )
      .run(`sess-${crypto.randomUUID()}`, "filter me");
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const filtered = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=agent-a&project=proj-a"),
    );
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.every((r) => r.project === "proj-a" && r.source === "agent-a")).toBe(true);
  });

  it("loads knowledge_file rows when category filter is set", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b14b-${crypto.randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, "note.md"), "# Note", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b14b", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    vi.resetModules();
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const loaded = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file"),
    );
    expect(loaded.rows.some((r) => r.category === "knowledge_file")).toBe(true);
  });
});
