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
const { DELETE } = await import("../route");

const ctx = (userId: string, keyId: string) => ({
  params: Promise.resolve({ userId, keyId }),
});

function seedUser(id: string) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, `${id}@example.com`, id, "hash", now);
}

function seedKey(keyId: string, userId: string, revokedAt: string | null = null) {
  testDb
    .prepare(
      "INSERT INTO user_api_keys (id, user_id, key_hash, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(keyId, userId, `hash-${keyId}`, "label", new Date().toISOString(), revokedAt);
}

describe("DELETE /api/users/[userId]/api-keys/[keyId]", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM user_api_keys");
    testDb.exec("DELETE FROM users");
    vi.mocked(authenticateUser).mockReset();
    seedUser("u1");
    seedKey("k1", "u1");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await DELETE(
      new Request("http://localhost/api/users/u1/api-keys/k1", { method: "DELETE" }) as never,
      ctx("u1", "k1")
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when revoking another users key without admin", async () => {
    seedUser("u2");
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    const res = await DELETE(
      new Request("http://localhost/api/users/u2/api-keys/k1", { method: "DELETE" }) as never,
      ctx("u2", "k1")
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when key not found or wrong owner", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    expect(
      (await DELETE(
        new Request("http://localhost/api/users/u1/api-keys/missing", { method: "DELETE" }) as never,
        ctx("u1", "missing")
      )).status
    ).toBe(404);
  });

  it("returns 409 when key already revoked", async () => {
    seedKey("k-revoked", "u1", new Date().toISOString());
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    const res = await DELETE(
      new Request("http://localhost/api/users/u1/api-keys/k-revoked", { method: "DELETE" }) as never,
      ctx("u1", "k-revoked")
    );
    expect(res.status).toBe(409);
  });

  it("revokes key and returns 204", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "u1@example.com",
      displayName: "u1",
      tenantId: "default-tenant",
    });
    const res = await DELETE(
      new Request("http://localhost/api/users/u1/api-keys/k1", { method: "DELETE" }) as never,
      ctx("u1", "k1")
    );
    expect(res.status).toBe(204);
    const row = testDb
      .prepare("SELECT revoked_at FROM user_api_keys WHERE id = ?")
      .get("k1") as { revoked_at: string | null };
    expect(row.revoked_at).not.toBeNull();
  });
});
