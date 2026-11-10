// @vitest-environment node
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

vi.mock("@/lib/auth/jwt", () => ({
  signAccessToken: vi.fn(async (userId: string, role: string) => `jwt:${userId}:${role}`),
}));

const { POST } = await import("../route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM user_roles");
    testDb.exec("DELETE FROM team_invitations");
    testDb.exec("DELETE FROM users");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: "not-json",
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when email or password missing", async () => {
    expect((await post({ email: "a@b.com" })).status).toBe(400);
    expect((await post({ password: "secret123" })).status).toBe(400);
  });

  it("registers first user as admin", async () => {
    const res = await post({ email: "first@example.com", password: "password123" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.accessToken).toMatch(/^jwt:/);
    const role = testDb
      .prepare("SELECT role FROM user_roles WHERE user_id = ?")
      .get(data.userId) as { role: string };
    expect(role.role).toBe("admin");
  });

  it("returns 403 when invite required for non-first user", async () => {
    await post({ email: "first@example.com", password: "password123" });
    const res = await post({ email: "second@example.com", password: "password123" });
    expect(res.status).toBe(403);
  });

  it("registers with valid invite token", async () => {
    await post({ email: "first@example.com", password: "password123" });
    const rawToken = "invite-token-raw";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const adminId = (
      testDb.prepare("SELECT id FROM users WHERE email = ?").get("first@example.com") as { id: string }
    ).id;
    testDb
      .prepare(
        `INSERT INTO team_invitations (id, token_hash, role, invited_by, email_hint, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("inv1", tokenHash, "operator", adminId, "second@example.com", new Date(Date.now() + 86400000).toISOString());

    const res = await post({
      email: "second@example.com",
      password: "password123",
      inviteToken: rawToken,
    });
    expect(res.status).toBe(201);
    const role = testDb
      .prepare("SELECT role FROM user_roles WHERE user_id = (SELECT id FROM users WHERE email = ?)")
      .get("second@example.com") as { role: string };
    expect(role.role).toBe("operator");
  });

  it("returns 404 for invalid invite token", async () => {
    await post({ email: "first@example.com", password: "password123" });
    const res = await post({
      email: "second@example.com",
      password: "password123",
      inviteToken: "bad-token",
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when email already registered", async () => {
    await post({ email: "first@example.com", password: "password123" });
    const adminId = (
      testDb.prepare("SELECT id FROM users WHERE email = ?").get("first@example.com") as { id: string }
    ).id;
    const insertInvite = (id: string, rawToken: string) => {
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      testDb
        .prepare(
          `INSERT INTO team_invitations (id, token_hash, role, invited_by, expires_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, tokenHash, "reviewer", adminId, new Date(Date.now() + 86400000).toISOString());
    };
    insertInvite("inv-dup-1", "invite-one");
    await post({ email: "dup@example.com", password: "password123", inviteToken: "invite-one" });
    insertInvite("inv-dup-2", "invite-two");
    const res = await post({
      email: "dup@example.com",
      password: "password456",
      inviteToken: "invite-two",
    });
    expect(res.status).toBe(409);
  });
});
