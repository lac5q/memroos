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
  collectCollectionFiles: vi.fn(async () => [
    { path: "/tmp/docs/a.md", mtime: new Date("2026-01-01T12:00:00.000Z") },
  ]),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(async () => ({ mtime: new Date("2026-01-02T12:00:00.000Z") })),
}));

const { GET } = await import("../route");

function makeGetRequest(): Request {
  return new Request("http://localhost/api/library/freshness", { method: "GET" });
}

describe("GET /api/library/freshness", () => {
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

  it("returns 401 when session is missing", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest() as never);
    expect(res.status).toBe(401);
  });

  it("returns collection freshness and qmd bounded state", async () => {
    testDb
      .prepare(
        `INSERT INTO memory_qmd_updates
         (id, target_path, source_hash, status, freshness_timestamp, last_success_timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "upd-1",
        "/tmp/index.sqlite",
        "abc123",
        "pending",
        "2026-01-03T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z"
      );

    const res = await GET(makeGetRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.isUpdating).toBe(true);
    expect(body.qmd.updateId).toBe("upd-1");
    expect(body.qmd.status).toBe("pending");
    expect(body.collections).toHaveLength(1);
    expect(body.collections[0].collection).toBe("docs");
    expect(body).toHaveProperty("timestamp");
  });

  it("reports isUpdating false when no pending qmd update", async () => {
    const res = await GET(makeGetRequest() as never);
    const body = await res.json();
    expect(body.isUpdating).toBe(false);
    expect(body.qmd.status).toBeNull();
  });
});
