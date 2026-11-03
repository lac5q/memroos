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

const { POST } = await import("../route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function seedResetToken(rawToken: string, opts?: { used?: boolean; expired?: boolean }) {
  const now = new Date().toISOString();
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run("u1", "user@example.com", "User", "old-hash", now);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  testDb
    .prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      "prt1",
      "u1",
      tokenHash,
      opts?.expired ? new Date(Date.now() - 1000).toISOString() : new Date(Date.now() + 3600_000).toISOString(),
      opts?.used ? now : null
    );
}

describe("POST /api/auth/password-reset/confirm", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM auth_events");
    testDb.exec("DELETE FROM password_reset_tokens");
    testDb.exec("DELETE FROM user_refresh_tokens");
    testDb.exec("DELETE FROM users");
  });

  it("returns 400 for invalid JSON", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/auth/password-reset/confirm", {
            method: "POST",
            body: "bad",
          })
        )
      ).status
    ).toBe(400);
  });

  it("returns 400 when token or password missing or too short", async () => {
    expect((await post({ token: "t" })).status).toBe(400);
    expect((await post({ password: "12345678" })).status).toBe(400);
    expect((await post({ token: "t", password: "short" })).status).toBe(400);
  });

  it("returns 404 for unknown token", async () => {
    expect((await post({ token: "nope", password: "newpass123" })).status).toBe(404);
  });

  it("returns 404 for expired token", async () => {
    seedResetToken("expired-one", { expired: true });
    expect((await post({ token: "expired-one", password: "newpass123" })).status).toBe(404);
  });

  it("returns 404 for already-used token", async () => {
    seedResetToken("used-one", { used: true });
    expect((await post({ token: "used-one", password: "newpass123" })).status).toBe(404);
  });

  it("updates password and marks token used on success", async () => {
    const raw = "reset-raw-token";
    seedResetToken(raw);
    const res = await post({ token: raw, password: "newpass123" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const user = testDb.prepare("SELECT password_hash FROM users WHERE id = ?").get("u1") as {
      password_hash: string;
    };
    expect(user.password_hash).toBe("hashed:newpass123");
    const tok = testDb
      .prepare("SELECT used_at FROM password_reset_tokens WHERE id = ?")
      .get("prt1") as { used_at: string | null };
    expect(tok.used_at).not.toBeNull();
  });
});
