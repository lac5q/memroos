// @vitest-environment node
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const LOOPBACK = "http://localhost";

let adminUserId = "";

function seedAdminUser() {
  const now = new Date().toISOString();
  adminUserId = `admin-${randomUUID().slice(0, 6)}`;
  testDb
    .prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(adminUserId, `admin-${randomUUID().slice(0, 4)}@example.com`, "Admin", "hash", now);
}

function seedInvite(rawToken: string, opts: { used?: boolean; expired?: boolean }) {
  const now = new Date().toISOString();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = opts.expired
    ? new Date(Date.now() - 3600_000).toISOString()
    : new Date(Date.now() + 3600_000).toISOString();
  testDb
    .prepare(
      `INSERT INTO team_invitations (id, token_hash, role, invited_by, email_hint, used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `inv-${randomUUID().slice(0, 6)}`,
      tokenHash,
      "reviewer",
      adminUserId,
      "invite@example.com",
      opts.used ? now : null,
      expiresAt,
    );
}

describe("POST /api/auth/register batch33", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM team_invitations");
    testDb.exec("DELETE FROM user_roles");
    testDb.exec("DELETE FROM users");
    seedAdminUser();
  });

  it("returns 409 when invitation was already used (L55)", async () => {
    const token = `used-${randomUUID()}`;
    seedInvite(token, { used: true });
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `user-${randomUUID().slice(0, 6)}@example.com`,
          password: "ValidPass123!",
          inviteToken: token,
        }),
      }) as never,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already used/i);
  });

  it("returns 410 when invitation expired (L56)", async () => {
    const token = `expired-${randomUUID()}`;
    seedInvite(token, { expired: true });
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `user-${randomUUID().slice(0, 6)}@example.com`,
          password: "ValidPass123!",
          inviteToken: token,
        }),
      }) as never,
    );
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/expired/i);
  });
});
