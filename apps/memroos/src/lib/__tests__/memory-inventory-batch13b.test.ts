// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec("DELETE FROM messages");
  testDb.exec("DELETE FROM memory_salience");
});

describe("memory-inventory batch13b — filter and category edges", () => {
  it("includes knowledge_file category in default inventory response", async () => {
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    expect(response.categories.some((c) => c.id === "knowledge_file")).toBe(true);
  });

  it("returns knowledge rows when category=knowledge_file is requested", async () => {
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=knowledge_file")
    );
    expect(response.rows.every((r) => r.category === "knowledge_file")).toBe(true);
  });

  it("filters ingested_message rows by project parameter", async () => {
    const messageId = testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, ?, ?, 'user', ?, '2026-01-02T00:00:00Z', 'internal', 'indexable')`
      )
      .run(`sess-${crypto.randomUUID()}`, "proj-alpha", "agent-a", "alpha message").lastInsertRowid as number;
    testDb
      .prepare("INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?, 'mid', 1.0, ?)")
      .run(messageId, "2025-12-31T00:00:00.000Z");
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, ?, ?, 'user', ?, '2026-01-02T00:00:00Z', 'internal', 'indexable')`
      )
      .run(`sess-${crypto.randomUUID()}`, "proj-beta", "agent-b", "beta message");
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message&project=proj-alpha")
    );
    expect(response.rows.length).toBeGreaterThanOrEqual(1);
    expect(response.rows.every((r) => r.project === "proj-alpha")).toBe(true);
  });

  it("graph_fact category warns when Neo4j password is unset", async () => {
    const prior = process.env.NEO4J_PASSWORD;
    delete process.env.NEO4J_PASSWORD;
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(new URL("http://localhost/api/memory-inventory"));
    const graph = response.categories.find((c) => c.id === "graph_fact");
    expect(graph?.warnings.some((w) => w.toLowerCase().includes("password"))).toBe(true);
    if (prior) process.env.NEO4J_PASSWORD = prior;
  });

  it("returns ingested_message rows filtered by consolidationState", async () => {
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, consolidated, visibility, policy)
         VALUES (?, 'proj', 'agent', 'user', ?, '2026-01-02T00:00:00Z', 0, 'internal', 'indexable')`
      )
      .run(`sess-${crypto.randomUUID()}`, "pending consolidation");
    const { buildMemoryInventory } = await import("@/lib/memory-inventory");
    const response = await buildMemoryInventory(
      new URL("http://localhost/api/memory-inventory?category=ingested_message&consolidationState=pending")
    );
    expect(response.rows.every((r) => r.consolidationState === "pending")).toBe(true);
  });
});
