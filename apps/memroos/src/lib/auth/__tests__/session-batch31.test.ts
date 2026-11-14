// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const mockVerifyAccessToken = vi.fn();

vi.mock("@/lib/auth/jwt", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

describe("auth/session batch31", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
  });

  it("returns null for invalid JWT payload (line 42)", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/x", {
        headers: { authorization: "Bearer eyJhb.a.b" },
      }),
    );
    expect(res).toBeNull();
  });

  it("returns null when API key user row is missing (line 68)", async () => {
    const dbPath = `/tmp/session-b31-${randomUUID()}.db`;
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const userId = `user-b31-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-b31-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'orphan-b31@localhost', 'Orphan', 'hash', 'default-tenant', datetime('now'))`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'orphan', datetime('now'))`,
    ).run(userId, keyHash);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res).toBeNull();
    dbMod.closeDb();
  });

  it("returns null when database lookup throws (line 89)", async () => {
    process.env.SQLITE_DB_PATH = `/tmp/does-not-exist-b31-${randomUUID()}/nested/db.sqlite`;
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { authenticateUser } = await import("@/lib/auth/session");
    const token = `plain-api-key-b31-${randomUUID()}`;
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res).toBeNull();
    vi.restoreAllMocks();
  });
});
