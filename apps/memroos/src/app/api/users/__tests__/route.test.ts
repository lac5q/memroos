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
      "INSERT INTO users (id, email, display_name, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, email, email.split("@")[0], "hash", now, null);
  testDb.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)").run(id, role);
}

describe("GET /api/users", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM user_roles");
    testDb.exec("DELETE FROM users");
    vi.mocked(authenticateUser).mockReset();
    seedUser("u1", "alpha@example.com", "reviewer");
    seedUser("u2", "beta@example.com", "operator");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/users") as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u2",
      role: "operator",
      email: "beta@example.com",
      displayName: "beta",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/users") as never);
    expect(res.status).toBe(403);
  });

  it("lists users with roles for admin", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/users") as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.users).toHaveLength(2);
    expect(data.users[0]).toMatchObject({
      id: "u1",
      email: "alpha@example.com",
      role: "reviewer",
    });
  });
});
