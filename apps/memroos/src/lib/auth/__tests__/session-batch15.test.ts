// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const mockVerifyAccessToken = vi.fn();

vi.mock("@/lib/auth/jwt", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

describe("auth/session batch15", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
  });

  it("returns session from JWT and from active API keys via cookie", async () => {
    mockVerifyAccessToken.mockResolvedValueOnce({ sub: "user-jwt", role: "operator" });
    const { authenticateUser } = await import("@/lib/auth/session");
    const jwtReq = new Request("http://localhost/api/x", {
      headers: { authorization: "Bearer eyJhbG.a.b" },
    });
    const jwtUser = await authenticateUser(jwtReq);
    expect(jwtUser?.userId).toBe("user-jwt");

    mockVerifyAccessToken.mockResolvedValueOnce(null);
    const dbPath = `/tmp/session-b15-${randomUUID()}.db`;
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const userId = `u-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'u@test.com', 'User', 'hash', 'default-tenant', datetime('now'))`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_roles (user_id, role) VALUES (?, 'operator')`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'test', datetime('now'))`,
    ).run(userId, keyHash);

    const { authenticateUser: auth2 } = await import("@/lib/auth/session");
    const cookieReq = new Request("http://localhost/api/x", {
      headers: { cookie: `access_token=${encodeURIComponent(token)}` },
    });
    const apiUser = await auth2(cookieReq);
    expect(apiUser?.email).toBe("u@test.com");
    expect(apiUser?.role).toBe("operator");

    dbMod.closeDb();
  });

  it("returns null when API key is revoked or db fails", async () => {
    const dbPath = `/tmp/session-b15-rev-${randomUUID()}.db`;
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const token = "revoked-token";
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES ('u-rev', 'r@test.com', 'Rev', 'hash', 'default-tenant', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at, revoked_at)
       VALUES ('u-rev', ?, 'rev', datetime('now'), datetime('now'))`,
    ).run(keyHash);

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost/api/x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res).toBeNull();
    dbMod.closeDb();
  });
});
