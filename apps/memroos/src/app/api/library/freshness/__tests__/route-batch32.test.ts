// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticateUser = vi.hoisted(() => vi.fn());
const collectCollectionFiles = vi.hoisted(() => vi.fn());
const loadCollections = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/knowledge-collections", () => ({
  collectCollectionFiles: (...args: unknown[]) => collectCollectionFiles(...args),
  loadCollections: () => loadCollections(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => getDb(),
  closeDb: () => {},
}));

const session = {
  userId: "u-b32",
  role: "reviewer" as const,
  email: "rev@example.com",
  displayName: "Rev",
  tenantId: "default-tenant",
};

describe("GET /api/library/freshness batch32", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    collectCollectionFiles.mockReset();
    loadCollections.mockReset();
    getDb.mockReset();
    authenticateUser.mockResolvedValue(session);
    collectCollectionFiles.mockResolvedValue([{ path: "/tmp/x.md", mtime: new Date() }]);
    loadCollections.mockReturnValue([
      {
        name: "docs-b32",
        category: "docs",
        sources: [{ path: "/nonexistent-b32", pattern: "**/*.md" }],
      },
    ]);
    getDb.mockReturnValue({
      prepare: (sql: string) => ({
        get: () => {
          if (sql.includes("sqlite_master")) return { name: "memory_qmd_updates" };
          throw new Error("qmd table corrupt");
        },
      }),
    });
  });

  it("swallows qmd update read failures (line 75)", async () => {
    vi.resetModules();
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/library/freshness"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qmd.status).toBeNull();
  });

  it("swallows collection mtime walk failures (line 116)", async () => {
    collectCollectionFiles.mockRejectedValueOnce(new Error("walk failed"));
    vi.resetModules();
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/library/freshness"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections.length).toBeGreaterThanOrEqual(1);
    expect(body.collections[0].collection).toBe("docs-b32");
  });
});
