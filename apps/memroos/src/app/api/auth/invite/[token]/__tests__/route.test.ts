// @vitest-environment node
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { GET } = await import("../route");

const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

function seedInvite(rawToken: string, opts?: { used?: boolean; expired?: boolean; role?: string }) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run("admin-1", "admin@example.com", "Admin", "hash", now);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = opts?.expired
    ? new Date(Date.now() - 3600_000).toISOString()
    : new Date(Date.now() + 3600_000).toISOString();
  testDb
    .prepare(
      `INSERT INTO team_invitations (id, token_hash, role, invited_by, email_hint, used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "inv1",
      tokenHash,
      opts?.role ?? "reviewer",
      "admin-1",
      "hint@example.com",
      opts?.used ? now : null,
      expiresAt
    );
}

describe("GET /api/auth/invite/[token]", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM team_invitations");
    testDb.exec("DELETE FROM users");
  });

  it("returns 404 for unknown token", async () => {
    const res = await GET(new Request("http://localhost/api/auth/invite/x") as never, ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns role and emailHint for valid token", async () => {
    const raw = "valid-invite-token";
    seedInvite(raw, { role: "operator" });
    const res = await GET(new Request("http://localhost/api/auth/invite/x") as never, ctx(raw));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "operator", emailHint: "hint@example.com" });
  });

  it("returns 404 when invitation already used", async () => {
    const raw = "used-token";
    seedInvite(raw, { used: true });
    const res = await GET(new Request("http://localhost/api/auth/invite/x") as never, ctx(raw));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/already used/i);
  });

  it("returns 404 when invitation expired", async () => {
    const raw = "expired-token";
    seedInvite(raw, { expired: true });
    const res = await GET(new Request("http://localhost/api/auth/invite/x") as never, ctx(raw));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/expired/i);
  });
});
