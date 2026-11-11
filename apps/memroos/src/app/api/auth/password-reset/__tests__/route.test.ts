// @vitest-environment node
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, vi } from "vitest";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { POST } = await import("../route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost:3000" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/auth/password-reset", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM auth_events");
    testDb.exec("DELETE FROM password_reset_tokens");
    testDb.exec("DELETE FROM users");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/password-reset", { method: "POST", body: "nope" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when email missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("returns ok with null resetUrl for unknown email (no enumeration)", async () => {
    const res = await post({ email: "unknown@example.com" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.resetUrl).toBeNull();
    expect(data.delivery).toBe("manual");
  });

  it("creates reset token and returns resetUrl for known user", async () => {
    const now = new Date().toISOString();
    testDb
      .prepare(
        "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("u1", "user@example.com", "User", "hash", now);
    vi.stubEnv("MEMROOS_BASE_URL", "https://memroos.test");
    const res = await post({ email: "USER@example.com" });
    vi.unstubAllEnvs();
    const data = await res.json();
    expect(data.resetUrl).toMatch(/^https:\/\/memroos\.test\/reset-password\//);
    const tokens = testDb.prepare("SELECT COUNT(*) as c FROM password_reset_tokens").get() as { c: number };
    expect(tokens.c).toBe(1);
    const events = testDb.prepare("SELECT COUNT(*) as c FROM auth_events").get() as { c: number };
    expect(events.c).toBe(1);
  });
});
