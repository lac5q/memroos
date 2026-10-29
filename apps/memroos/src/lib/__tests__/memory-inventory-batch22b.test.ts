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
  neo4jConfig: () => ({ password: "", url: "" }),
  neo4jHttpQuery: vi.fn(async () => ({ results: [], errors: [] })),
}));

describe("memory-inventory batch22b — knowledge_file rows", () => {
  let tmp: string;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("buildMemoryInventory lists knowledge_file rows for configured collections", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `know-b22b-${crypto.randomUUID()}-`));
    const configPath = path.join(tmp, "collections.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "notes-b22b", category: "skills", basePath: tmp }],
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "sample-b22b.md"), "# note\n", "utf8");
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
      new URL("http://localhost/api/memory-inventory?category=knowledge_file&source=notes-b22b"),
    );
    expect(response.rows.some((row) => row.category === "knowledge_file")).toBe(true);
  });
});
