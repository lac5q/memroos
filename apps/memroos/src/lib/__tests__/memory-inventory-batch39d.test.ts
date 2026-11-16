// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/memory/backends", () => ({
  mem0HealthTimeoutMs: () => 5000,
  neo4jConfig: () => ({ password: "", url: "http://localhost:7474", database: "neo4j" }),
  neo4jHttpQuery: vi.fn(async () => ({ results: [], errors: [] as unknown[] })),
}));

vi.mock("@/lib/db", () => ({ getDb: () => testDb, closeDb: () => {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  testDb.exec("DELETE FROM agent_memory_writes");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch39d", () => {
  it.skip("knowledgeRows early return (555) — buildMemoryInventory only calls knowledgeRows when category=knowledge_file", () => {});

  it("buildMemoryInventory includes knowledge_file rows when category filter matches (556+)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b39d-${randomUUID()}-`));
    const collectionDir = path.join(tmp, "notes");
    fs.mkdirSync(collectionDir, { recursive: true });
    const noteName = `note-b39d-${randomUUID().slice(0, 6)}.md`;
    fs.writeFileSync(path.join(collectionDir, noteName), "# Batch39d knowledge", "utf8");
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ collections: [{ name: "notes-b39d", category: "skills", basePath: "notes" }] }),
      "utf8",
    );
    vi.stubEnv("KNOWLEDGE_BASE_PATH", tmp);
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }),
      })),
    );

    const { buildMemoryInventory, _resetMemoryInventoryCacheForTest } = await import("@/lib/memory-inventory");
    _resetMemoryInventoryCacheForTest();
    const response = await buildMemoryInventory(
      new URL(`http://localhost/api/memory-inventory?category=knowledge_file&trace=b39d-${randomUUID().slice(0, 6)}`),
    );
    expect(response.rows.some((r) => r.category === "knowledge_file" && r.content.includes("notes"))).toBe(true);

    process.env.HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});