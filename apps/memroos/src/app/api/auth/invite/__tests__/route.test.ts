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
const { POST } = await import("../route");

function seedAdmin(id = "admin-1") {
  const now = new Date().toISOString();
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, "admin@example.com", "Admin", "hash", now);
  testDb.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)").run(id, "admin");
}

function post(body: unknown, host = "localhost:3000") {
  return POST(
    new Request("http://localhost/api/auth/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", host },
      body: JSON.stringify(body),
    }) as never
  );
}

describe("POST /api/auth/invite", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM team_invitations");
    testDb.exec("DELETE FROM user_roles");
    testDb.exec("DELETE FROM users");
    vi.mocked(authenticateUser).mockReset();
    seedAdmin();
  });

  it("returns 403 when unauthenticated (role gate runs first)", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await post({ role: "reviewer" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "admin-1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await post({ role: "reviewer" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body or role", async () => {
    const adminSession = {
      userId: "admin-1",
      role: "admin" as const,
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    };
    vi.mocked(authenticateUser).mockResolvedValue(adminSession);
    expect(
      (
        await POST(
          new Request("http://localhost/api/auth/invite", { method: "POST", body: "x" }) as never
        )
      ).status
    ).toBe(400);
    const badRole = await post({ role: "superuser" });
    expect(badRole.status).toBe(400);
  });

  it("creates invitation and returns invite URL", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    vi.stubEnv("MEMROOS_BASE_URL", "https://memroos.test");
    const res = await post({ role: "reviewer", emailHint: "new@example.com" });
    vi.unstubAllEnvs();
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.inviteUrl).toMatch(/^https:\/\/memroos\.test\/invite\//);
    const count = testDb.prepare("SELECT COUNT(*) as c FROM team_invitations").get() as { c: number };
    expect(count.c).toBe(1);
  });
});
