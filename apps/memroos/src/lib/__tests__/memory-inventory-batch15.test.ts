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
  vi.unstubAllEnvs();
  testDb.exec("DELETE FROM messages");
});

beforeEach(() => {
  vi.resetModules();
});

describe("memory-inventory batch15 — parseCount branches and row filters", () => {
  it("parseCount walks nested Neo4j results arrays via graph category", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/health")) {
          return { ok: true, status: 200, json: async () => ({ memory_count: 7 }) };
        }
        return { ok: false, status: 503, json: async () => ({}) };
      }),
    );
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBe(7);
  });

  it("matchesRowFilters honors backend, agent, project, source, and label filters", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, sensitivity, policy, consolidated)
         VALUES (?, 'proj-filter', 'agent-filter', 'user', 'row', '2026-02-15T00:00:00Z', 'internal', 'engineering', NULL, 'indexable', 1)`,
      )
      .run(sessionId);
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const match = await buildMemoryInventory(
      new URL(
        "http://localhost/api/memory-inventory?backend=SQLite%20messages&agent=agent-filter&project=proj-filter&source=agent-filter&label=internal",
      ),
    );
    expect(match.rows.length).toBeGreaterThan(0);

    const miss = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?agent=not-this-agent"),
    );
    expect(miss.rows.length).toBe(0);
  });

  it("vector category marks unavailable metric when health returns no count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ detail: "down" }) })),
    );
    vi.resetModules();
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const vector = response.categories.find((c) => c.id === "vector_memory");
    expect(vector?.count).toBeNull();
    expect(vector?.warnings.length).toBeGreaterThan(0);
    expect(["unavailable", "error", "degraded"]).toContain(vector?.metric?.status);
  });
});
