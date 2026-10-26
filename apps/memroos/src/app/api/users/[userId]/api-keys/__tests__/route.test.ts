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
const { GET, POST } = await import("../route");

const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });

function seedUser(id: string) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, `${id}@example.com`, id, "hash", now);
  testDb.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)").run(id, "reviewer");
}

describe("/api/users/[userId]/api-keys", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM user_api_keys");
    testDb.exec("DELETE FROM user_roles");
    testDb.exec("DELETE FROM users");
    vi.mocked(authenticateUser).mockReset();
    seedUser("u1");
    seedUser("u2");
  });

  it("POST returns 401 when unauthenticated", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/users/u1/api-keys", { method: "POST", body: "{}" }) as never,
      ctx("u1")
    );
    expect(res.status).toBe(401);
  });

  it("POST returns 403 when creating keys for another user", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/users/u2/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "x" }),
      }) as never,
      ctx("u2")
    );
    expect(res.status).toBe(403);
  });

  it("POST returns 404 when target user missing", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/users/missing/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }) as never,
      ctx("missing")
    );
    expect(res.status).toBe(404);
  });

  it("POST creates API key for self", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/users/u1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "cli" }),
      }) as never,
      ctx("u1")
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.label).toBe("cli");
    expect(data.keyRaw).toHaveLength(64);
  });

  it("GET lists non-revoked keys", async () => {
    const now = new Date().toISOString();
    testDb
      .prepare(
        "INSERT INTO user_api_keys (id, user_id, key_hash, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run("k1", "u1", "hash1", "active", now, null);
    testDb
      .prepare(
        "INSERT INTO user_api_keys (id, user_id, key_hash, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run("k2", "u1", "hash2", "revoked", now, now);
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    const res = await GET(new Request("http://localhost/api/users/u1/api-keys") as never, ctx("u1"));
    const data = await res.json();
    expect(data.apiKeys).toHaveLength(1);
    expect(data.apiKeys[0].id).toBe("k1");
  });
});
