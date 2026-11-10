// @vitest-environment node
import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(),
}));

const { authenticateUser } = await import("@/lib/auth/session");
const { GET } = await import("../route");

function seedUser(id: string, email: string, role: "admin" | "operator" | "reviewer") {
  const now = new Date().toISOString();
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, email, "Display", "hash", now);
  testDb.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)").run(id, role);
}

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM user_roles");
    testDb.exec("DELETE FROM users");
    vi.mocked(authenticateUser).mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/auth/me");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 404 when session user is missing from DB", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "ghost",
      role: "admin",
      email: "ghost@example.com",
      displayName: "Ghost",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/auth/me") as never);
    expect(res.status).toBe(404);
  });

  it("returns profile with role from user_roles", async () => {
    seedUser("u1", "me@example.com", "operator");
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "me@example.com",
      displayName: "Display",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/auth/me") as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      id: "u1",
      email: "me@example.com",
      displayName: "Display",
      tenantId: "default-tenant",
      role: "operator",
    });
  });

  it("defaults role to reviewer when user_roles row is absent", async () => {
    const now = new Date().toISOString();
    testDb
      .prepare(
        "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("u2", "norole@example.com", "No Role", "hash", now);
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u2",
      role: "reviewer",
      email: "norole@example.com",
      displayName: "No Role",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/auth/me") as never);
    const data = await res.json();
    expect(data.role).toBe("reviewer");
  });
});
