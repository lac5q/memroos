// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => [{ name: "docs", paths: ["/tmp/docs"] }]),
  collectCollectionFiles: vi.fn(async () => []),
}));

const { GET } = await import("../route");

function makeGetRequest(): Request {
  return new Request("http://localhost/api/library/freshness", { method: "GET" });
}

describe("GET /api/library/freshness batch25b", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
    });
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS memory_qmd_updates (
        id TEXT PRIMARY KEY,
        target_path TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        freshness_timestamp TEXT NOT NULL,
        last_success_timestamp TEXT
      );
      DELETE FROM memory_qmd_updates;
    `);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces failed bounded qmd updates without isUpdating", async () => {
    testDb
      .prepare(
        `INSERT INTO memory_qmd_updates
         (id, target_path, source_hash, status, freshness_timestamp, last_success_timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("upd-fail-b25b", "/tmp/index.sqlite", "abc", "failed", "2026-01-03T00:00:00.000Z", null);

    const res = await GET(makeGetRequest() as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.isUpdating).toBe(false);
    expect(body.qmd.status).toBe("failed");
    expect(body.qmd.updateId).toBe("upd-fail-b25b");
  });

  it("returns null source mtime when a collection has no files", async () => {
    const res = await GET(makeGetRequest() as never);
    const body = await res.json();
    expect(body.collections[0].sourceMtime).toBeNull();
  });
});
