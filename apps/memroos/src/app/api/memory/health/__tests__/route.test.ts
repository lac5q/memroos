// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

vi.mock("@/lib/db", () => ({
  getDb: () => db,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/backends", () => ({
  checkVectorHealth: vi.fn(async () => ({ tier: "vector", backend: "qdrant", status: "degraded", count: 0, lastWrite: null })),
  checkGraphHealth: vi.fn(async () => ({ tier: "graph", backend: "neo4j", status: "degraded", count: 0, lastWrite: null })),
}));

const { GET } = await import("../route");

describe("GET /api/memory/health", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("returns 403 for non-local callers without operator or agent auth", async () => {
    const res = await GET(new Request("https://memroos.example.com/api/memory/health"));
    expect(res.status).toBe(403);
  });

  it("reports recall ingest as stale when no ingest timestamp exists", async () => {
    const res = await GET(new Request("http://localhost/api/memory/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recallIngest.status).toBe("stale");
    expect(body.tiers).toHaveLength(3);
  });

  it("marks recall ingest stale when timestamp is invalid", async () => {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("last_ingest_ts", "not-a-date");
    const res = await GET(new Request("http://localhost/api/memory/health"));
    const body = await res.json();
    expect(body.recallIngest.detail).toBe("Last recall ingest timestamp is invalid");
  });
});
